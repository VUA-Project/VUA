//! Replaceable time and identity sources (ORC-TST-001): tests never depend on
//! the real clock or random order.
//!
//! # 中文逐段讲解（E-S0 审阅）
//!
//! 这个文件解决一个测试领域的大敌：**不确定性**。如果任务事件的时间戳、
//! 任务 ID 都来自真实时钟，测试就没法断言"事件顺序应该是什么"。
//!
//!
//! `Clock` trait —— 只有一个方法 `now_rfc3339()`：返回 RFC 3339 格式的
//! UTC 时间字符串（如 `2026-08-31T08:00:00.000Z`）。所有需要"现在几点"
//! 的代码（任务事件、journal 条目、StateFile）都通过它要时间，而不是
//! 直接调 `SystemTime::now()`——这样测试就能塞进一个假时钟。
//!
//! `SystemClock` —— 生产实现，包装真实时钟。
//!
//! `FixedClock` —— 测试实现：构造时给一串预定读数，`now_rfc3339()` 依次
//! 吐出；读数用完后**停格在最后一条**（而不是 panic 或绕回），这让
//! "只需要一个固定时间"的测试不用关心吐了几次。
//!
//! `TaskIdGenerator` trait + 两个实现 —— 任务 ID 的来源。生产实现
//! `NanosTaskIdGenerator` 用"纳秒时间戳 + 进程内计数器"拼 ID：既有唯一
//! 性，又不需要 UUID 库；测试实现 `FixedIdGenerator` 纯计数器（task-
//! fixed-0001、0002……），断言可以写死 ID。trait 的意义同 Clock：测试
//! 可替换（ORC-TST-001）。
//!
//! `rfc3339()` —— 手写的"Unix 时间 → RFC 3339 字符串"转换。**不引
//! chrono/time 等日期库**（ORC-DEV-005：每个依赖都要登记理由，而这里
//! 只需要一种格式化），核心是 `civil_from_days`——一个公开的、被广泛
//! 验证的算法（Howard Hinnant），把"距 1970-01-01 的天数"换算成
//! 年月日，正确处理闰年。测试用三个已知时刻锁定：Unix 纪元、
//! 2023-11-14、以及 2000-02-29（闰日——平年算法最容易错的场景）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Produces RFC 3339 UTC timestamps for envelopes and journal entries.
pub trait Clock: Send + Sync {
    fn now_rfc3339(&self) -> String;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_rfc3339(&self) -> String {
        rfc3339(SystemTime::now())
    }
}

/// Deterministic clock for tests and replay.
///
/// 语义：读数逐条消费；只剩最后一条时**粘住**不再前进——既保证多读不出错，
/// 又让"固定时间"测试写起来最短。
#[derive(Debug)]
pub struct FixedClock {
    readings: Mutex<Vec<String>>,
}

impl FixedClock {
    pub fn new(readings: &[&str]) -> Self {
        Self {
            readings: Mutex::new(readings.iter().map(|value| value.to_string()).collect()),
        }
    }
}

impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        let mut readings = self.readings.lock().expect("fixed clock poisoned");
        if readings.is_empty() {
            return "1970-01-01T00:00:00.000Z".into();
        }
        if readings.len() == 1 {
            return readings[0].clone();
        }
        readings.remove(0)
    }
}

/// Generates unique task ids. The production generator mixes wall-clock
/// nanoseconds with a process-local counter so fixed-clock tests still yield
/// distinct ids.
pub trait TaskIdGenerator: Send + Sync {
    fn generate(&self) -> String;
}

#[derive(Debug, Default)]
pub struct NanosTaskIdGenerator {
    counter: AtomicU64,
}

impl TaskIdGenerator for NanosTaskIdGenerator {
    fn generate(&self) -> String {
        let sequence = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        format!("task-{nanos}-{sequence:04}")
    }
}

#[derive(Debug, Default)]
pub struct FixedIdGenerator {
    counter: AtomicU64,
}

impl TaskIdGenerator for FixedIdGenerator {
    fn generate(&self) -> String {
        let sequence = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("task-fixed-{sequence:04}")
    }
}

/// Formats a `SystemTime` as RFC 3339 UTC with millisecond precision, without
/// pulling in a date-time dependency (ORC-DEV-005: no unregistered deps).
pub fn rfc3339(time: SystemTime) -> String {
    // 早于 1970 的时钟（系统时间倒退）按 0 处理：宁可给出纪元时刻也不 panic
    // （ORC-ERR-006：panic 不是业务控制流）。
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_millis = duration.as_millis() as i64;
    let millis = total_millis % 1000;
    // div_euclid/rem_euclid 对负数也正确（向负无穷取整），保证天数拆分无死角
    let seconds = total_millis.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z",
        hour = seconds_of_day / 3_600,
        minute = (seconds_of_day % 3_600) / 60,
        second = seconds_of_day % 60,
    )
}

/// Reads a UTC timestamp in the form [`rfc3339`] writes (`YYYY-MM-DDTHH:MM:SS[.fff]Z`) as
/// milliseconds since the Unix epoch.
pub fn rfc3339_millis(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let number = |range: std::ops::Range<usize>| -> Option<i64> {
        let part = text.get(range)?;
        part.bytes().all(|b| b.is_ascii_digit()).then(|| part.parse().ok())?
    };
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || bytes[13] != b':'
        || bytes[16] != b':' || bytes[bytes.len() - 1] != b'Z'
    {
        return None;
    }
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    let millis = match &text[19..text.len() - 1] {
        "" => 0,
        fraction if fraction.len() >= 2 && fraction.starts_with('.') && fraction.len() <= 10 => {
            let digits = &fraction[1..];
            let value: i64 = digits.bytes().all(|b| b.is_ascii_digit()).then(|| digits.parse().ok())??;
            value * 1000 / 10_i64.pow(digits.len() as u32)
        }
        _ => return None,
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let days = days_from_civil(year, month as u32, day as u32);
    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) * 1000) + millis)
}

/// Howard Hinnant's `days_from_civil`, the inverse of [`civil_from_days`].
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month_pointer = if month > 2 { month - 3 } else { month + 9 } as u64;
    let day_of_year = (153 * month_pointer + 2) / 5 + day as u64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era as i64 - 719_468
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 to (y, m, d).
///
/// 算法要点：先把天偏移到"虚拟纪元"0000-03-01（把 2 月挪到年尾，闰日变成
/// 年尾问题），按 400 年 = 146097 天的格里高利周期求 era，再用两次近似
/// 除法还原月份。搬运自公开算法，正确性由下方闰日测试向量锁定。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_pointer = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_pointer + 2) / 5 + 1) as u32;
    let month = if month_pointer < 10 {
        month_pointer + 3
    } else {
        month_pointer - 9
    } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn formats_known_instants_as_rfc3339_utc() {
        assert_eq!(rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(1_700_000_000)),
            "2023-11-14T22:13:20.000Z"
        );
        // Leap day: 2000-02-29T00:00:00Z.
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00:00:00.000Z"
        );
    }

    #[test]
    fn pins_leap_century_year_rollover_and_the_measured_recipe_instant() {
        // Ordinary leap year: 2024-02-29T00:00:00Z.
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "2024-02-29T00:00:00.000Z"
        );
        // Century NON-leap: 2100-02-29 does not exist — the day after
        // 2100-02-28 is 2100-03-01 (the 36,524-day correction in
        // `civil_from_days` exists for exactly this edge).
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(4_107_456_000)),
            "2100-02-28T00:00:00.000Z"
        );
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_secs(4_107_542_400)),
            "2100-03-01T00:00:00.000Z"
        );
        // Year rollover at the last millisecond of 2025.
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_millis(1_767_225_599_999)),
            "2025-12-31T23:59:59.999Z"
        );
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_millis(1_767_225_600_000)),
            "2026-01-01T00:00:00.000Z"
        );
        // Data-seat regression pin (batch 156, observation A): a recipe saved
        // at 2026-09-19T20:16:59.769Z was stamped by the former inline
        // 365-day/30-month division as 2026-07-16T20:16:59.770Z — a civil
        // date two months in the past. The real calendar must keep the real
        // date (the +1ms outer stamp is the store clock at save time, the
        // contract "store clock at save" face of StoredRecipeDocument).
        assert_eq!(
            rfc3339(UNIX_EPOCH + Duration::from_millis(1_789_849_019_770)),
            "2026-09-19T20:16:59.770Z"
        );
    }

    #[test]
    fn reads_back_the_timestamps_it_writes() {
        for millis in [0_i64, 951_782_400_000, 1_709_164_800_123, 1_767_225_599_999, 4_107_542_400_000] {
            let text = rfc3339(UNIX_EPOCH + Duration::from_millis(millis as u64));
            assert_eq!(rfc3339_millis(&text), Some(millis), "{text}");
        }
        assert_eq!(rfc3339_millis("2026-10-17T08:00:00Z"), Some(1_792_224_000_000));
        assert_eq!(rfc3339_millis("2026-10-17T08:00:00.5Z"), Some(1_792_224_000_500));
        for invalid in ["", "2026-10-17", "2026-13-01T00:00:00.000Z", "2026-10-17T08:00:00.000+09:00", "2026-10-17T08:00:00.Z", "x026-10-17T08:00:00.000Z"] {
            assert_eq!(rfc3339_millis(invalid), None, "{invalid}");
        }
    }

    #[test]
    fn fixed_clock_walks_readings_then_sticks() {
        let clock = FixedClock::new(&["2026-08-30T10:00:00.000Z", "2026-08-30T10:00:01.000Z"]);
        assert_eq!(clock.now_rfc3339(), "2026-08-30T10:00:00.000Z");
        assert_eq!(clock.now_rfc3339(), "2026-08-30T10:00:01.000Z");
        assert_eq!(clock.now_rfc3339(), "2026-08-30T10:00:01.000Z");
    }

    #[test]
    fn fixed_ids_are_unique_within_a_process() {
        let generator = FixedIdGenerator::default();
        let first = generator.generate();
        let second = generator.generate();
        assert_ne!(first, second);
    }
}
