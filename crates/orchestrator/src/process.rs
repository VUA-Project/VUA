//! Process runner port (ORC-ADP-001..003, ORC-CON-004, O6 minimal): external
//! programs are executed through a fixed executable identity with typed
//! arguments, a mandatory timeout and bounded output. No shell, ever.
//!
//! # 中文逐段讲解（E-PKG 审阅）
//!
//! 这是所有"调外部程序"的唯一通道——vrc-get、Unity batchmode 都走它，
//! 不许任何代码自己 `Command::new`（E-ASSEMB 时把 bridge/provision 迁进来了，
//! 就是为了消灭第二个进程管理点）。
//!
//!
//! `ProcessSpec` —— 一次调用的完整描述：固定可执行文件路径（不进 PATH
//! 搜索拼命令）、类型化参数数组（`ProcessSpec.args` 由各引擎拼装，用户
//! 输入先经校验才能进来——ORC-ADP-004 的"不接收 View 拼的参数数组"）、
//! *必填**超时（没有默认无限等待这回事，ORC-CON-004）、输出上限。
//!
//! `StdProcessRunner::run` 的四道工序：
//! `Command::new(executable)` + `.args()` —— 直接 exec，**不经
//! cmd/powershell**，从根上消灭命令注入（ORC-ADP-001）；
//! 两个读线程分别抽干 stdout/stderr（见 `drain_bounded`）——不抽干
//! 会怎样？子进程写满 OS 管道缓冲（约 64KB）就卡死在 write 上，
//! 父进程却在 wait → 双方互等死锁。抽干同时只保留前 limit 字节，
//! 内存有上界；
//! 轮询 `try_wait` 直到退出码或超时——std 没有带超时的 wait，只能
//! 5ms 一次轮询；超时就 `kill()` 后再 `wait()` 收尸（不留僵尸）。
//! Windows 上普通调用进入独立 Job Object；超时、取消或父进程正常
//! 结束时都会收束本次调用留下的整个进程树，并记录是否清理完成；
//! 需要 UAC 的 NSIS 安装器交给 Windows 提权并单独等待，安装适配器核验产物；
//! 汇总 `ProcessOutcome`：退出码、是否超时、截断后的输出。
//!
//! `drain_bounded` —— `total > limit` 才置 truncated 标记并追加
//! `...[truncated]` 尾注：消费方看到尾注就知道日志被剪过。
//!
//! `FakeProcessRunner` —— 消费者契约测试的核心道具（ORC-DEV-003）：
//! `calls` 记录每次收到的 spec → 测试断言"参数必须是这四个、不许
//! 出现 cmd.exe"；
//! `script` 队列按次回放脚本化结果（空队列默认成功）；
//! `on_run` 副作用钩子 → 模拟"后端真的改了项目状态"（比如装包后
//! 写 manifest），让引擎层的验证逻辑有真东西可验；
//! `clear_calls` → 把 discovery 探测的调用清零，让断言从已知点计数。
//!
//! 错误只有一个 `Io` 变体：进程调用的一切失败都归结为 io::Error，
//! 各引擎负责把它翻译成自己的稳定错误码（如 `vua.vpm.install_failed`）。

use std::collections::VecDeque;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// One external process invocation. `args` are typed values assembled by the
/// owning adapter — never user-joined strings (ORC-ADP-004).
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    /// NSIS installers consume /D= followed by the entire unquoted command-line tail.
    /// Keep this a directory value, assembled by the owning adapter, never shell text.
    /// Normal programs leave it absent and retain standard argument escaping.
    pub windows_nsis_install_dir: Option<PathBuf>,
    /// Reviewed NSIS installers whose manifest requires administrator access use
    /// Windows' native elevation and direct wait from the start. Do not place their
    /// bootstrapper/driver children in the owned per-invocation process tree.
    /// The allowed argument vocabulary remains exactly /S with optional /D.
    pub windows_elevated_nsis: bool,
    pub working_dir: Option<PathBuf>,
    /// Mandatory wall-clock budget (ORC-CON-004: unlimited waits are not
    /// accepted).
    pub timeout: Duration,
    /// Cap on captured stdout/stderr in bytes; excess is drained and marked
    /// truncated (ORC-ADP-003).
    pub output_limit: usize,
    /// 环境覆盖（Fix 8 / R2-2, ORC-ADP-003）：默认完整继承 VUA 进程环境
    /// （本地单机应用中那是用户自己的环境）；键命中 `removals` 时从子进程
    /// 环境剥离，`sets` 逐键覆盖。各适配器统一叠加
    /// [`CREDENTIAL_ENV_REMOVALS`] 凭据剥离基线；代理变量按工具决定是否
    /// 剥离（vrc-get/VCC 下载可能确实需要用户代理）。
    pub removals: Vec<String>,
    pub sets: std::collections::BTreeMap<String, String>,
}

/// 凭据类环境变量剥离基线（R2-2）：这些变量对 VUA 调用的工具没有正当
/// 用途，剥离防止 VUA 进程环境里的第三方令牌流入子进程。代理变量不在
/// 基线内——vrc-get/VCC 下载可能依赖用户代理；按工具策略在 H-IPC 细化。
pub const CREDENTIAL_ENV_REMOVALS: &[&str] = &[
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GIT_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "CARGO_REGISTRY_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AZURE_CLIENT_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
];

impl Default for ProcessSpec {
    fn default() -> Self {
        Self {
            executable: PathBuf::new(),
            args: Vec::new(),
            windows_nsis_install_dir: None,
            windows_elevated_nsis: false,
            working_dir: None,
            timeout: Duration::ZERO,
            output_limit: 0,
            // 安全基线属于 ProcessRunner 边界，而不是每个调用方的可选
            // 约定。所有通过 `..Default::default()` 构造的生产适配器都会
            // 继承父进程环境，同时剥离已知凭据；工具仍可按需追加变量。
            removals: CREDENTIAL_ENV_REMOVALS
                .iter()
                .map(|name| (*name).to_owned())
                .collect(),
            sets: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessOutcome {
    pub exit_code: Option<i32>,
    /// True when the timeout fired. Ordinary owned processes are killed; an
    /// OS-owned elevated installer remains available for user inspection.
    pub timed_out: bool,
    /// True when a caller-provided cancellation signal stopped the process.
    pub cancelled: bool,
    /// On Windows, true only after the per-invocation Job Object reports no
    /// surviving process. Other platforms currently guarantee the direct
    /// child only and therefore report false.
    pub process_tree_clean: bool,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

impl ProcessOutcome {
    pub fn success(&self) -> bool {
        !self.timed_out && !self.cancelled && self.exit_code == Some(0)
    }
}

#[derive(Debug)]
pub enum ProcessError {
    Io(std::io::Error),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "process execution failed: {error}"),
        }
    }
}

impl std::error::Error for ProcessError {}

pub trait ProcessRunner: Send + Sync {
    fn run(&self, spec: &ProcessSpec) -> Result<ProcessOutcome, ProcessError>;

    /// Runs with a cooperative caller-side cancellation signal. Implementors
    /// that cannot interrupt an invocation retain the original behavior; the
    /// standard runner polls the signal and terminates its owned process tree.
    fn run_cancellable(
        &self,
        spec: &ProcessSpec,
        _is_cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<ProcessOutcome, ProcessError> {
        self.run(spec)
    }
}

/// Windows owns elevation for a reviewed NSIS installer. The adapter verifies its output.
/// Elevated processes are waited directly; no command interpreter or output pipe is used.
/// `/D=` is appended only when the adapter pins a destination; installers whose vendor
/// chooses the destination (Steam, PICO Connect) elevate with the bare `/S` gate.
#[cfg(windows)]
fn run_elevated_nsis(spec: &ProcessSpec) -> Result<ProcessOutcome, ProcessError> {
    use windows_sys::Win32::{
        Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{GetExitCodeProcess, WaitForSingleObject},
        UI::{
            Shell::{
                ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_HIDE,
        },
    };
    let executable = spec.executable.to_string_lossy();
    let invalid_directory = spec.windows_nsis_install_dir.as_ref().is_some_and(|path| {
        let value = path.to_string_lossy();
        !path.is_absolute() || value.contains('"') || value.chars().any(char::is_control)
    });
    if spec.args != ["/S"]
        || spec.timeout.is_zero()
        || spec.timeout > Duration::from_secs(7200)
        || !spec.executable.is_absolute()
        || executable.contains('"')
        || executable.chars().any(char::is_control)
        || invalid_directory
    {
        return Err(ProcessError::Io(std::io::Error::other(
            "unsupported elevated installer command",
        )));
    }
    let wide = |value: &str| value.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let exe = wide(&spec.executable.to_string_lossy());
    let verb = wide("runas");
    // /D must stay the final unquoted tail when present; without a pinned destination the
    // closed vocabulary is exactly "/S".
    let args = wide(&match &spec.windows_nsis_install_dir {
        Some(directory) => format!("/S /D={}", directory.display()),
        None => "/S".to_owned(),
    });
    // SAFETY: all UTF-16 buffers outlive ShellExecuteExW; zeroed optional fields are absent.
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = exe.as_ptr();
    info.lpParameters = args.as_ptr();
    info.nShow = SW_HIDE;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(ProcessError::Io(std::io::Error::last_os_error()));
    }
    struct ElevatedHandle(HANDLE);
    impl Drop for ElevatedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    let handle = ElevatedHandle(info.hProcess);
    if handle.0.is_null() {
        return Err(ProcessError::Io(std::io::Error::other(
            "missing installer process",
        )));
    }
    let waited = unsafe { WaitForSingleObject(handle.0, spec.timeout.as_millis() as u32) };
    if waited != WAIT_OBJECT_0 && waited != WAIT_TIMEOUT {
        return Err(ProcessError::Io(std::io::Error::last_os_error()));
    }
    let mut exit_code = 0;
    if waited == WAIT_OBJECT_0 && unsafe { GetExitCodeProcess(handle.0, &mut exit_code) } == 0 {
        return Err(ProcessError::Io(std::io::Error::last_os_error()));
    }
    Ok(ProcessOutcome {
        exit_code: (waited == WAIT_OBJECT_0).then_some(exit_code as i32),
        timed_out: waited == WAIT_TIMEOUT,
        cancelled: false,
        process_tree_clean: false,
        stdout: String::new(),
        stderr: String::new(),
        truncated: false,
    })
}

/// Real runner over `std::process`. The child is spawned without a shell;
/// output is drained on dedicated threads and capped. Ordinary Windows invocations
/// use a Job Object; an elevation-required NSIS installer uses the explicit OS-owned path.
#[derive(Debug, Default)]
pub struct StdProcessRunner;

impl ProcessRunner for StdProcessRunner {
    fn run(&self, spec: &ProcessSpec) -> Result<ProcessOutcome, ProcessError> {
        self.run_cancellable(spec, &|| false)
    }

    fn run_cancellable(
        &self,
        spec: &ProcessSpec,
        is_cancelled: &(dyn Fn() -> bool + Send + Sync),
    ) -> Result<ProcessOutcome, ProcessError> {
        if spec.windows_elevated_nsis {
            #[cfg(windows)]
            return run_elevated_nsis(spec);
            #[cfg(not(windows))]
            return Err(ProcessError::Io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "native NSIS installation requires Windows",
            )));
        }
        // 直接 exec 固定可执行文件：参数是独立数组元素传给 OS 的 execve，
        // 不存在"被 shell 重新解释"的环节，注入无从谈起（ORC-ADP-001）。
        // stdin 直接关闭：外部工具不该等输入。
        let mut command = Command::new(&spec.executable);
        #[cfg(windows)]
        if let Some(directory) = &spec.windows_nsis_install_dir {
            use std::os::windows::process::CommandExt;
            let directory = directory.to_string_lossy();
            if !directory.starts_with(|c: char| c.is_ascii_alphabetic())
                || !directory.as_bytes().get(1).is_some_and(|b| *b == b':')
                || !directory
                    .as_bytes()
                    .get(2)
                    .is_some_and(|b| matches!(b, b'\\' | b'/'))
                || directory.chars().any(|c| c.is_control() || c == '"')
            {
                return Err(ProcessError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "invalid NSIS directory",
                )));
            }
            command.args(&spec.args).raw_arg(format!("/D={directory}"));
        } else {
            command.args(&spec.args);
        }
        #[cfg(not(windows))]
        {
            if spec.windows_nsis_install_dir.is_some() {
                return Err(ProcessError::Io(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "NSIS installation requires Windows",
                )));
            }
            command.args(&spec.args);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &spec.working_dir {
            command.current_dir(dir);
        }
        // 环境覆盖（Fix 8）：先剥离再设置；未列出的变量原样继承。
        for key in &spec.removals {
            command.env_remove(key);
        }
        for (key, value) in &spec.sets {
            command.env(key, value);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            // Existing destination-pinned Unity installers retain their UAC fallback.
            #[cfg(windows)]
            Err(error)
                if error.raw_os_error() == Some(740) && spec.windows_nsis_install_dir.is_some() =>
            {
                return run_elevated_nsis(spec);
            }
            Err(error) => return Err(ProcessError::Io(error)),
        };
        #[cfg(windows)]
        let process_job = match ProcessJob::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ProcessError::Io(error));
            }
        };

        // 两条独立的抽干线：无论子进程输出多少、多快，管道都不会积压，
        // 父进程可以专心等退出（见 drain_bounded 的死锁说明）。
        let mut stdout_pipe = child.stdout.take().expect("stdout piped");
        let mut stderr_pipe = child.stderr.take().expect("stderr piped");
        let limit = spec.output_limit;
        let stdout_reader = std::thread::spawn(move || drain_bounded(&mut stdout_pipe, limit));
        let stderr_reader = std::thread::spawn(move || drain_bounded(&mut stderr_pipe, limit));

        let deadline = Instant::now() + spec.timeout;
        let mut timed_out = false;
        let mut cancelled = false;
        let exit_code = loop {
            match child.try_wait().map_err(ProcessError::Io)? {
                Some(status) => break status.code(),
                None => {
                    if is_cancelled() {
                        #[cfg(windows)]
                        process_job.terminate();
                        #[cfg(not(windows))]
                        let _ = child.kill();
                        let _ = child.wait();
                        cancelled = true;
                        break None;
                    }
                    if Instant::now() >= deadline {
                        #[cfg(windows)]
                        process_job.terminate();
                        #[cfg(not(windows))]
                        let _ = child.kill();
                        let _ = child.wait();
                        timed_out = true;
                        break None;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        };

        // A tool that exits while leaving helpers behind does not own those
        // helpers beyond this invocation. Terminating the job before joining
        // the pipe readers also prevents an inherited stdout handle from
        // keeping the readers blocked forever.
        #[cfg(windows)]
        let process_tree_clean = process_job.finish();
        #[cfg(not(windows))]
        let process_tree_clean = false;

        let (stdout, stdout_truncated) = stdout_reader
            .join()
            .map_err(|_| ProcessError::Io(std::io::Error::other("stdout reader panicked")))?;
        let (stderr, stderr_truncated) = stderr_reader
            .join()
            .map_err(|_| ProcessError::Io(std::io::Error::other("stderr reader panicked")))?;
        Ok(ProcessOutcome {
            exit_code,
            timed_out,
            cancelled,
            process_tree_clean,
            stdout,
            stderr,
            truncated: stdout_truncated || stderr_truncated,
        })
    }
}

#[cfg(windows)]
struct ProcessJob {
    handle: HANDLE,
}

#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &std::process::Child) -> std::io::Result<Self> {
        // SAFETY: the initialized structures have the exact Win32 layout and
        // the child/process handles remain valid for each call.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(error);
            }
            if AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) == 0 {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(error);
            }
            Ok(Self { handle })
        }
    }

    fn terminate(&self) {
        // SAFETY: handle is owned and valid until Drop.
        unsafe {
            let _ = TerminateJobObject(self.handle, 1);
        }
    }

    fn finish(&self) -> bool {
        self.terminate();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            // SAFETY: accounting points at writable storage of the requested
            // information class and has the matching byte size.
            let active = unsafe {
                let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
                let ok = QueryInformationJobObject(
                    self.handle,
                    JobObjectBasicAccountingInformation,
                    (&raw mut accounting).cast(),
                    std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                    std::ptr::null_mut(),
                );
                (ok != 0).then_some(accounting.ActiveProcesses)
            };
            match active {
                Some(0) => return true,
                None => return false,
                Some(_) if Instant::now() >= deadline => return false,
                Some(_) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        // SAFETY: this guard uniquely owns the handle.
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

/// Reads a pipe to EOF while retaining at most `limit` bytes, so a chatty
/// child can neither grow memory unboundedly nor deadlock on a full pipe.
fn drain_bounded(pipe: &mut impl Read, limit: usize) -> (String, bool) {
    let mut kept: Vec<u8> = Vec::new();
    let mut total: usize = 0;
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                total += read;
                if kept.len() < limit {
                    let remaining = limit - kept.len();
                    kept.extend_from_slice(&chunk[..read.min(remaining)]);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    let truncated = total > limit;
    let mut text = String::from_utf8_lossy(&kept).into_owned();
    if truncated {
        text.push_str("\n...[truncated]");
    }
    (text, truncated)
}

/// Scripted runner for tests and consumer contracts (ORC-DEV-003): records
/// every spec, replays scripted outcomes, and can apply a side effect so
/// engine-level tests can simulate the backend mutating project state.
type SideEffect = Box<dyn Fn(&ProcessSpec) + Send + Sync>;

/// One queued reply. Beyond plain messages, tests can script an IO failure
/// carrying a raw Windows error code (740 elevation-required, 1223
/// user-declined) so adapters exercise their elevation mapping.
enum FakeReply {
    Outcome(ProcessOutcome),
    Message(String),
    RawOsError(i32),
}

#[derive(Default)]
pub struct FakeProcessRunner {
    calls: Mutex<Vec<ProcessSpec>>,
    script: Mutex<VecDeque<FakeReply>>,
    on_run: Mutex<Option<SideEffect>>,
}

impl FakeProcessRunner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queues one outcome; when the script is empty the runner answers with a
    /// successful empty outcome.
    pub fn push(&self, outcome: Result<ProcessOutcome, String>) -> &Self {
        self.script
            .lock()
            .expect("fake script poisoned")
            .push_back(match outcome {
                Ok(outcome) => FakeReply::Outcome(outcome),
                Err(message) => FakeReply::Message(message),
            });
        self
    }

    /// Queues one IO failure carrying a raw OS error code, which a plain
    /// message cannot express (e.g. 740/1223 from an elevation boundary).
    pub fn push_raw_os_error(&self, raw_os_error: i32) -> &Self {
        self.script
            .lock()
            .expect("fake script poisoned")
            .push_back(FakeReply::RawOsError(raw_os_error));
        self
    }

    pub fn on_run(&self, effect: impl Fn(&ProcessSpec) + Send + Sync + 'static) -> &Self {
        *self.on_run.lock().expect("fake on_run poisoned") = Some(Box::new(effect));
        self
    }

    pub fn calls(&self) -> Vec<ProcessSpec> {
        self.calls.lock().expect("fake calls poisoned").clone()
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().expect("fake calls poisoned").len()
    }

    /// Drops recorded calls, e.g. after the discovery probe, so assertions
    /// can count calls from a known point.
    pub fn clear_calls(&self) -> &Self {
        self.calls.lock().expect("fake calls poisoned").clear();
        self
    }
}

impl ProcessRunner for FakeProcessRunner {
    fn run(&self, spec: &ProcessSpec) -> Result<ProcessOutcome, ProcessError> {
        self.calls
            .lock()
            .expect("fake calls poisoned")
            .push(spec.clone());
        if let Some(effect) = self.on_run.lock().expect("fake on_run poisoned").as_ref() {
            effect(spec);
        }
        let next = self
            .script
            .lock()
            .expect("fake script poisoned")
            .pop_front();
        match next {
            Some(FakeReply::Outcome(outcome)) => Ok(outcome),
            Some(FakeReply::Message(message)) => {
                Err(ProcessError::Io(std::io::Error::other(message)))
            }
            Some(FakeReply::RawOsError(code)) => {
                Err(ProcessError::Io(std::io::Error::from_raw_os_error(code)))
            }
            None => Ok(ProcessOutcome {
                exit_code: Some(0),
                timed_out: false,
                cancelled: false,
                process_tree_clean: true,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
            }),
        }
    }
}

/// Convenience for tests: a scripted outcome with an exit code.
pub fn outcome_with_exit(code: i32, stderr: &str) -> ProcessOutcome {
    ProcessOutcome {
        exit_code: Some(code),
        timed_out: false,
        cancelled: false,
        process_tree_clean: true,
        stdout: String::new(),
        stderr: stderr.to_owned(),
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn node_spec(script: &str, timeout: Duration, limit: usize) -> ProcessSpec {
        ProcessSpec {
            executable: PathBuf::from("node"),
            args: ["-e".to_owned(), script.to_owned()].into_iter().collect(),
            working_dir: None,
            timeout,
            output_limit: limit,
            ..Default::default()
        }
    }

    #[test]
    fn orc_adp_001_std_runner_executes_typed_args_without_a_shell() {
        let outcome = StdProcessRunner
            .run(&node_spec(
                "console.log('typed-args-ok')",
                Duration::from_secs(15),
                4096,
            ))
            .unwrap();
        assert!(outcome.success(), "{outcome:?}");
        assert!(outcome.stdout.contains("typed-args-ok"));
        assert!(!outcome.truncated);
    }

    #[cfg(windows)]
    #[test]
    fn nsis_directory_tail_preserves_spaces_and_punctuation_without_a_shell() {
        let mut spec = node_spec(
            "process.stdout.write(process.argv.slice(1).join(' '))",
            Duration::from_secs(15),
            4096,
        );
        let directory = r"C:\VUA Test\Editors $&;";
        spec.windows_nsis_install_dir = Some(directory.into());
        let outcome = StdProcessRunner.run(&spec).unwrap();
        assert!(outcome.success(), "{outcome:?}");
        assert_eq!(outcome.stdout, format!("/D={directory}"));
        for invalid in [r"C:relative", "C:\\quote\"", "C:\\new\nline"] {
            spec.windows_nsis_install_dir = Some(invalid.into());
            assert!(StdProcessRunner.run(&spec).is_err());
        }
    }

    #[test]
    fn orc_adp_003_every_process_spec_inherits_the_credential_hygiene_baseline() {
        let spec = ProcessSpec::default();
        for credential in CREDENTIAL_ENV_REMOVALS {
            assert!(
                spec.removals.iter().any(|name| name == credential),
                "default process boundary must strip {credential}"
            );
        }
        assert!(
            !spec.removals.iter().any(|name| name == "HTTP_PROXY"),
            "proxy inheritance remains an explicit per-tool decision"
        );
    }

    #[test]
    fn orc_con_004_std_runner_enforces_the_timeout_and_kills_the_child() {
        let started = Instant::now();
        let outcome = StdProcessRunner
            .run(&node_spec(
                "setTimeout(() => {}, 30_000)",
                Duration::from_millis(120),
                4096,
            ))
            .unwrap();
        assert!(outcome.timed_out);
        assert!(!outcome.cancelled);
        #[cfg(windows)]
        assert!(outcome.process_tree_clean);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn b3_spike_std_runner_cancels_an_owned_process_tree() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancelled);
        let setter = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            signal.store(true, Ordering::SeqCst);
        });
        let outcome = StdProcessRunner
            .run_cancellable(
                &node_spec(
                    "setTimeout(() => {}, 30_000)",
                    Duration::from_secs(30),
                    4096,
                ),
                &|| cancelled.load(Ordering::SeqCst),
            )
            .unwrap();
        setter.join().unwrap();
        assert!(outcome.cancelled);
        assert!(!outcome.timed_out);
        #[cfg(windows)]
        assert!(outcome.process_tree_clean);
    }

    #[cfg(windows)]
    #[test]
    fn b3_spike_std_runner_cleans_helpers_left_by_a_successful_parent() {
        let outcome = StdProcessRunner
            .run(&node_spec(
                "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'}).unref();",
                Duration::from_secs(15),
                4096,
            ))
            .unwrap();
        assert!(outcome.success(), "{outcome:?}");
        assert!(outcome.process_tree_clean);
    }

    #[test]
    fn orc_adp_003_std_runner_bounds_captured_output() {
        let outcome = StdProcessRunner
            .run(&node_spec(
                "process.stdout.write('x'.repeat(5_000_000))",
                Duration::from_secs(60),
                1024,
            ))
            .unwrap();
        assert!(outcome.truncated);
        assert!(outcome.stdout.len() <= 1024 + "\n...[truncated]".len());
        assert!(outcome.stdout.starts_with('x'));
    }

    #[test]
    fn orc_dev_003_fake_runner_records_specs_and_replays_script() {
        let runner = FakeProcessRunner::new();
        runner.push(Ok(outcome_with_exit(2, "boom")));
        let spec = node_spec("1", Duration::from_secs(1), 128);
        let first = runner.run(&spec).unwrap();
        assert_eq!(first.exit_code, Some(2));
        let second = runner.run(&spec).unwrap();
        assert_eq!(second.exit_code, Some(0), "empty script answers success");
        assert_eq!(runner.call_count(), 2);
        assert_eq!(runner.calls()[0], spec);
    }

    #[test]
    fn orc_dev_003_fake_runner_scripts_raw_os_errors_for_elevation_mapping() {
        let runner = FakeProcessRunner::new();
        runner.push_raw_os_error(740);
        let spec = node_spec("1", Duration::from_secs(1), 128);
        match runner.run(&spec) {
            Err(ProcessError::Io(error)) => assert_eq!(error.raw_os_error(), Some(740)),
            other => panic!("expected a raw OS error, got {other:?}"),
        }
        assert!(
            runner.run(&spec).unwrap().success(),
            "an empty script still answers success"
        );
    }

    /// The vendor-chosen-destination shape (bare "/S") passes the same closed
    /// vocabulary gate; rejections return before any OS elevation call.
    #[cfg(windows)]
    #[test]
    fn elevated_nsis_gate_keeps_the_closed_vocabulary_without_a_pinned_destination() {
        let mut spec = node_spec("1", Duration::from_secs(1800), 4096);
        spec.executable = r"C:\VUA\SteamSetup.exe".into();
        spec.windows_elevated_nsis = true;
        for bad_args in [
            vec![],
            vec!["/S".to_owned(), "/D=x".to_owned()],
            vec!["/quiet".to_owned()],
        ] {
            spec.args = bad_args;
            assert!(StdProcessRunner.run(&spec).is_err());
        }
        spec.args = vec!["/S".to_owned()];
        spec.timeout = Duration::ZERO;
        assert!(run_elevated_nsis(&spec).is_err());
        spec.timeout = Duration::from_secs(7201);
        assert!(run_elevated_nsis(&spec).is_err());
        spec.timeout = Duration::from_secs(1800);
        for directory in [r"C:relative", "C:\\bad\"path", "C:\\bad\npath"] {
            spec.windows_nsis_install_dir = Some(directory.into());
            assert!(StdProcessRunner.run(&spec).is_err());
        }
        spec.windows_nsis_install_dir = None;
        spec.executable = "SteamSetup.exe".into();
        assert!(StdProcessRunner.run(&spec).is_err());
    }
}
