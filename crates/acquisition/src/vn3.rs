//! Versioned, closed-vocabulary VN3 parsing. Raw fragments retain their original bytes.
use regex::Regex;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};
use unicode_normalization::UnicodeNormalization;
use vua_bdl_store::terms::{TermItem, TermWarning, TermsDocument};

pub const PARSER_VERSION: &str = "vn3-parser/1";
const MAX_TEXT: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vocabulary {
    versions: Vec<[String; 2]>,
    keys: BTreeMap<String, String>,
    headings: BTreeMap<String, BTreeMap<String, String>>,
    groups: BTreeMap<String, Vec<String>>,
    summary_labels: BTreeMap<String, Vec<String>>,
    values: Vec<Choice>,
}
#[derive(Deserialize)]
struct Choice {
    text: String,
    value: String,
    condition: Option<String>,
}
fn vocabulary() -> &'static Vocabulary {
    static RULES: OnceLock<Vocabulary> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("../data/vn3-vocabulary-v1.json"))
            .expect("versioned VN3 vocabulary")
    })
}
pub fn normalize(text: &str) -> String {
    text.nfkc().filter(|c| !c.is_whitespace()).collect()
}

struct Text<'a> {
    raw: &'a str,
    flat: String,
    starts: Vec<usize>,
    ends: Vec<usize>,
}
impl<'a> Text<'a> {
    fn new(raw: &'a str) -> Self {
        let mut out = Self {
            raw,
            flat: String::new(),
            starts: Vec::new(),
            ends: Vec::new(),
        };
        for (at, c) in raw.char_indices() {
            for n in c.to_string().nfkc().filter(|c| !c.is_whitespace()) {
                out.flat.push(n);
                for _ in 0..n.len_utf8() {
                    out.starts.push(at);
                    out.ends.push(at + c.len_utf8());
                }
            }
        }
        out
    }
    fn raw(&self, start: usize, end: usize) -> String {
        if start >= end || start >= self.starts.len() {
            return String::new();
        }
        self.raw[self.starts[start]..self.ends[end - 1]]
            .trim()
            .into()
    }
    fn field(&self, start: usize, left: &str, right: &str) -> Option<String> {
        let a = start + self.flat[start..].find(left)? + left.len();
        let b = a + self.flat[a..].find(right)?;
        let value = self.raw(a, b);
        (!value.is_empty()).then_some(value)
    }
}

fn warning(document: &mut TermsDocument, code: &str, item: Option<&str>) {
    document.warnings.push(TermWarning {
        code: code.into(),
        item: item.map(str::to_owned),
    });
}
fn choice(text: &str) -> Option<(&str, Option<&str>)> {
    vocabulary()
        .values
        .iter()
        .find(|v| normalize(&v.text).eq_ignore_ascii_case(text))
        .map(|v| (v.value.as_str(), v.condition.as_deref()))
}
pub fn empty_special_note(text: &str) -> bool {
    let text = normalize(text);
    ["", "なし", "無し", "None", "None.", "Nospecialnotes."]
        .iter()
        .any(|s| text.eq_ignore_ascii_case(s))
}
fn tail_start(text: &str) -> usize {
    let mut end = text.len();
    for marker in [
        "TheUser(s)aregrantedpermission",
        "上記の利用の許可には",
        "3.Specialnote",
        "3.特記事項",
    ] {
        if let Some(at) = text.find(marker) {
            end = end.min(at);
        }
    }
    for number in 1..=8 {
        if let Some(at) = text.find(&format!("({number})")) {
            end = end.min(at);
        }
    }
    end
}

pub fn parse_text(raw: &str, sha: &str) -> TermsDocument {
    let mut out = TermsDocument::empty("unrecognized", sha, PARSER_VERSION, "unrecognized_version");
    if raw.len() > MAX_TEXT {
        out.status = "unsupported".into();
        out.warnings[0].code = "text_limit".into();
        return out;
    }
    let text = Text::new(raw);
    let ja=Regex::new(r"VN3ライセンスVer\.([0-9][0-9A-Za-z._-]*)に準拠したVN3ライセンス利用規約ジェネレータVer\.([0-9][0-9A-Za-z._-]*)").expect("version regex");
    let en=Regex::new(r"(?i)VN3licensegeneratorversion([0-9][0-9A-Za-z._-]*)basedontheVN3licenseversion([0-9][0-9A-Za-z._-]*)").expect("version regex");
    let versions: Vec<_> = ja
        .captures_iter(&text.flat)
        .map(|v| {
            (
                "ja",
                v[2].trim_end_matches('.').to_owned(),
                v[1].trim_end_matches('.').to_owned(),
            )
        })
        .chain(en.captures_iter(&text.flat).map(|v| {
            (
                "en",
                v[1].trim_end_matches('.').to_owned(),
                v[2].trim_end_matches('.').to_owned(),
            )
        }))
        .collect();
    let Some((language, generator, vn3)) = versions.first().cloned() else {
        return out;
    };
    if versions
        .iter()
        .any(|v| v != &(language, generator.clone(), vn3.clone()))
    {
        out.warnings[0].code = "ambiguous_version".into();
        return out;
    }
    let header = if language == "ja" {
        "個別条件1.許諾対象データ"
    } else {
        "Termsforparticularcases1.TheDigitalContenttobelicensed"
    };
    out.generator_version = Some(generator.clone());
    out.vn3_version = Some(vn3.clone());
    out.language = Some(language.into());
    if !vocabulary().versions.contains(&[generator, vn3]) {
        return out;
    }
    let Some(start) = text.flat.rfind(header) else {
        out.warnings[0].code = "missing_detailed_section".into();
        return out;
    };
    let metadata = if language == "ja" {
        [
            "1.許諾対象データ",
            "2.利用条件",
            "4.権利者および権利者への問い合わせ先",
            "5.クレジット表記",
            "6.推奨するハッシュタグ",
            "7.許諾期間および許諾の変更等",
            "8.利用規約のバージョン",
            "この利用規約は、VN3ライセンス",
        ]
    } else {
        [
            "1.TheDigitalContenttobelicensed",
            "2.Conditionsofuse",
            "4.Licensor(s)andtheircontactinformation",
            "5.Creditnotation",
            "6.Recommendedhashtags",
            "7.Licenseperiodandmodificationofthelicense",
            "8.VersionofthisAgreement",
            "ThisAgreementwascreatedby",
        ]
    };
    out.status = "parsed".into();
    out.warnings.clear();
    out.content_title = text.field(start, metadata[0], metadata[1]);
    out.licensor = text.field(start, metadata[2], metadata[3]);
    out.credit_notation = text.field(start, metadata[3], metadata[4]);
    out.agreement_version = text
        .field(start, metadata[6], metadata[7])
        .map(|s| normalize(&s));
    if let Some(tags) = text.field(start, metadata[4], metadata[5]) {
        static HASHTAG_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
            Regex::new(r"#[\p{L}\p{M}\p{N}_]+").expect("hashtag regex")
        });
        out.hashtags = HASHTAG_REGEX
            .find_iter(&tags)
            .map(|m| m.as_str().into())
            .collect();
        if out.hashtags.is_empty() && !empty_special_note(&tags) {
            warning(&mut out, "unrecognized_hashtags", None);
        }
    }
    let end = start
        + text.flat[start..]
            .find(metadata[2])
            .unwrap_or(text.flat.len() - start);
    let items_start = text.flat[start..end]
        .find(metadata[1])
        .map_or(start, |at| start + at + metadata[1].len());
    static ITEM_HEADING_REGEX: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"([A-X])\.").expect("item regex"));
    let mut marks: Vec<_> = ITEM_HEADING_REGEX
        .captures_iter(&text.flat[items_start..end])
        .map(|c| {
            (
                c[1].to_owned(),
                items_start + c.get(0).unwrap().start(),
                items_start + c.get(0).unwrap().end(),
            )
        })
        .collect();
    // X is the final free-text item; lettered paragraphs inside it remain note evidence.
    if let Some(last) = marks.iter().position(|m| m.0 == "X") {
        marks.truncate(last + 1);
    }
    let summary = summary(&text, start, language);
    for letter in 'A'..='X' {
        let key = letter.to_string();
        let positions: Vec<_> = marks
            .iter()
            .enumerate()
            .filter(|(_, m)| m.0 == key)
            .collect();
        let mut item = TermItem {
            item: key.clone(),
            term_key: vocabulary().keys[&key].clone(),
            value: "unknown".into(),
            condition: None,
            raw_text: String::new(),
            summary_raw_text: None,
        };
        if positions.len() != 1 {
            warning(
                &mut out,
                if positions.is_empty() {
                    "missing_item"
                } else {
                    "duplicate_item"
                },
                Some(&key),
            );
            out.items.push(item);
            continue;
        }
        let (index, (_, _, body)) = positions[0];
        let limit = marks.get(index + 1).map_or(end, |m| m.1);
        let segment = &text.flat[*body..limit];
        if letter == 'X' {
            let label = if language == "ja" {
                "特記事項"
            } else {
                "Specialnote"
            };
            if let Some(special) = segment.strip_prefix(label) {
                item.raw_text = text.raw(body + label.len(), limit);
                if !empty_special_note(special) {
                    out.special_note = Some(item.raw_text.clone());
                }
                let anchor = format!("{}X{label}", vocabulary().groups[language][8]);
                if let Some(note_start) = text.flat[..start].find(&anchor).map(|p| p + anchor.len())
                {
                    let end_markers = if language == "ja" {
                        ["許諾対象データ", "個別条件"]
                    } else {
                        ["TheDigitalContenttobelicensed", "Termsforparticularcases"]
                    };
                    let note_end = end_markers
                        .iter()
                        .filter_map(|m| {
                            text.flat[note_start..start].find(m).map(|p| p + note_start)
                        })
                        .min()
                        .unwrap_or(start);
                    {
                        let summary_note = text.raw(note_start, note_end);
                        item.summary_raw_text = Some(summary_note.clone());
                        if !normalize(&summary_note).eq_ignore_ascii_case(special) {
                            warning(&mut out, "summary_conflict", Some("X"));
                            if out.special_note.is_none() && !empty_special_note(&summary_note) {
                                out.special_note = Some(summary_note);
                            }
                        }
                    }
                }
            } else {
                item.raw_text = text.raw(*body, limit);
                warning(&mut out, "unknown_heading", Some(&key));
            }
            out.items.push(item);
            continue;
        }
        let heading = &vocabulary().headings[language][&key];
        if !segment
            .get(..heading.len())
            .is_some_and(|s| s.eq_ignore_ascii_case(heading))
        {
            item.raw_text = text.raw(*body, limit);
            warning(&mut out, "unknown_heading", Some(&key));
            out.items.push(item);
            continue;
        }
        let value_at = body + heading.len();
        let tail = tail_start(&text.flat[value_at..limit]);
        item.raw_text = text.raw(value_at, value_at + tail);
        if let Some((value, condition)) = choice(&text.flat[value_at..value_at + tail]) {
            item.value = value.into();
            item.condition = condition.map(str::to_owned);
        } else {
            warning(&mut out, "unknown_wording", Some(&key));
        }
        if let Some((summary_value, summary_condition, raw)) = summary.get(&key) {
            item.summary_raw_text = Some(raw.clone());
            if summary_value == "unknown" {
                item.value = "unknown".into();
                item.condition = None;
                warning(&mut out, "summary_unknown_wording", Some(&key));
            } else if item.value != *summary_value || item.condition != *summary_condition {
                item.value = "unknown".into();
                item.condition = None;
                warning(&mut out, "summary_conflict", Some(&key));
            }
        }
        out.items.push(item);
    }
    if summary.is_empty() {
        warning(&mut out, "summary_unrecognized", None);
    }
    out
}

fn summary(
    text: &Text<'_>,
    details: usize,
    language: &str,
) -> BTreeMap<String, (String, Option<String>, String)> {
    let mut out = BTreeMap::new();
    let flat = &text.flat[..details];
    let groups = &vocabulary().groups[language];
    if !groups[..8].iter().any(|g| flat.contains(g)) {
        return out;
    }
    for (index, letters) in ["AB", "CDE", "FGH", "IJKL", "MN", "OPQR", "STU", "VW"]
        .iter()
        .enumerate()
    {
        let Some(group_start) = flat.find(&groups[index]) else {
            for letter in letters.chars() {
                out.insert(letter.to_string(), ("unknown".into(), None, String::new()));
            }
            continue;
        };
        let group_end = groups[index + 1..]
            .iter()
            .filter_map(|g| flat[group_start..].find(g).map(|p| p + group_start))
            .min()
            .unwrap_or(details);
        let mut values = group_start;
        let mut labels_match = true;
        for letter in letters.chars() {
            let label = &vocabulary().summary_labels[language][letter as usize - 'A' as usize];
            let anchor = format!("{letter}{label}");
            if let Some(at) = flat[values..group_end].find(&anchor) {
                values += at + anchor.len();
            } else {
                labels_match = false;
                break;
            }
        }
        if !labels_match {
            for letter in letters.chars() {
                out.insert(
                    letter.to_string(),
                    (
                        "unknown".into(),
                        None,
                        text.raw(group_start, group_end)
                            .chars()
                            .take(2000)
                            .collect(),
                    ),
                );
            }
            continue;
        }
        let mut pos = values;
        let mut group = Vec::new();
        for letter in letters.chars() {
            let found = vocabulary()
                .values
                .iter()
                .filter_map(|v| {
                    let value = normalize(&v.text);
                    flat[pos..group_end]
                        .get(..value.len())
                        .filter(|s| s.eq_ignore_ascii_case(&value))
                        .map(|_| (v, value.len()))
                })
                .max_by_key(|(_, len)| *len);
            let Some((value, len)) = found else { break };
            group.push((
                letter.to_string(),
                (
                    value.value.clone(),
                    value.condition.clone(),
                    text.raw(pos, pos + len),
                ),
            ));
            pos += len;
        }
        if group.len() == letters.len() && pos == group_end {
            out.extend(group);
        } else {
            for letter in letters.chars() {
                out.insert(
                    letter.to_string(),
                    (
                        "unknown".into(),
                        None,
                        text.raw(values, group_end).chars().take(2000).collect(),
                    ),
                );
            }
        }
    }
    out
}

/// PDF parsing keeps encryption and image-only files as explicit unsupported observations.
pub fn extract_pdf(bytes: &[u8]) -> Result<String, &'static str> {
    extract_pdf_cancellable(bytes, &|| false)
}
pub fn extract_pdf_cancellable(
    bytes: &[u8],
    cancelled: &dyn Fn() -> bool,
) -> Result<String, &'static str> {
    if !bytes.starts_with(b"%PDF-") {
        return Err("not_pdf");
    }
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if cancelled() {
            return Err("cancelled");
        }
        let document = pdf_extract::Document::load_mem(bytes).map_err(|_| "malformed_pdf")?;
        if document.is_encrypted() {
            return Err("encrypted_pdf");
        }
        if document.get_pages().len() > 128 {
            return Err("page_limit");
        }
        let mut output = BoundedText {
            bytes: Vec::new(),
            problem: None,
            cancelled,
            next_check: 0,
        };
        let mut writer = pdf_extract::PlainTextOutput::new(&mut output as &mut dyn std::io::Write);
        let result = pdf_extract::output_doc(&document, &mut writer);
        if let Some(problem) = output.problem {
            return Err(problem);
        }
        result.map_err(|_| "text_extraction_failed")?;
        let text = String::from_utf8(output.bytes).map_err(|_| "text_extraction_failed")?;
        if text.trim().is_empty() {
            return Err("no_text_layer");
        }
        Ok(text)
    }))
    .unwrap_or(Err("malformed_pdf"))
}

struct BoundedText<'a> {
    bytes: Vec<u8>,
    problem: Option<&'static str>,
    cancelled: &'a dyn Fn() -> bool,
    next_check: usize,
}
impl std::io::Write for BoundedText<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.bytes.len() >= self.next_check {
            self.next_check = self.bytes.len() + 4096;
            if (self.cancelled)() {
                self.problem = Some("cancelled");
                return Err(std::io::ErrorKind::Other.into());
            }
        }
        if self.bytes.len().saturating_add(bytes.len()) > MAX_TEXT {
            self.problem = Some("text_limit");
            return Err(std::io::ErrorKind::OutOfMemory.into());
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
