use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use vua_acquisition::{
    terms::{
        self,
        download::{FetchOutcome, TermsTransport},
        TermsService,
    },
    terms_links, vn3,
};
use vua_bdl_store::{
    terms::{TermsDocument, TermsLink},
    BdlStore, ProductObservation, ProductObservationStatus,
};
use vua_orchestrator::{FixedClock, NanosTaskIdGenerator, SqliteTaskStore, TaskRuntime, TaskState};

const EN: &str = include_str!("fixtures/vn3-en.synthetic.txt");
const JA: &str = include_str!("fixtures/vn3-ja.synthetic.txt");
const NOW: &str = "2026-10-19T00:00:00.000Z";
fn parsed(text: &str) -> TermsDocument {
    vn3::parse_text(text, &terms_links::sha256(text.as_bytes()))
}
fn product(store: &BdlStore, id: &str, description: Option<&str>) {
    store
        .record_product_observation(&ProductObservation {
            product_id: id.into(),
            native_product_id: id[6..].into(),
            library_type: Some("bought".into()),
            variant_name: None,
            source_url: format!("https://booth.pm/items/{}", &id[6..]),
            final_url: None,
            status: ProductObservationStatus::Complete,
            source_locale: None,
            source_category: None,
            title: Some("Synthetic product".into()),
            description: description.map(str::to_owned),
            age_restriction: None,
            adult: false,
            availability: None,
            price_amount: None,
            price_currency: None,
            shop_name: None,
            shop_url: None,
            image_urls: Vec::new(),
            video_urls: Vec::new(),
            subproducts: Vec::new(),
            source_published_at: None,
            content_hash: format!("sha256:{}", "a".repeat(64)),
            observed_at: NOW.into(),
            run_id: None,
            processor_version: "synthetic/1".into(),
            missing_fields: Vec::new(),
        })
        .unwrap();
}
fn attach(store: &BdlStore, id: &str, name: &str, document: &TermsDocument) {
    let link = terms_links::recognize_link(&format!("https://drive.google.com/file/d/{name}/view"))
        .unwrap();
    let mut links: Vec<_> = store
        .product_terms(id)
        .unwrap()
        .sources
        .into_iter()
        .map(|s| s.link)
        .collect();
    links.push(link.clone());
    store.record_terms_links(id, &links, NOW).unwrap();
    store
        .record_terms_result(&link.source_id, &document.status, NOW, None, Some(document))
        .unwrap();
}

#[test]
fn synthetic_languages_versions_conditions_and_special_notes_are_parsed() {
    for (text, generator, language) in [(EN, "1.10", "en"), (JA, "1.11", "ja")] {
        let doc = parsed(text);
        assert_eq!(doc.status, "parsed");
        assert_eq!(doc.generator_version.as_deref(), Some(generator));
        assert_eq!(doc.vn3_version.as_deref(), Some("1.10"));
        assert_eq!(doc.language.as_deref(), Some(language));
        assert_eq!(doc.items.len(), 24);
        assert!(doc.special_note.is_some());
        assert!(
            !doc.items
                .iter()
                .any(|i| i.value == "unknown" && i.item != "X"),
            "{:?}",
            doc.warnings
        );
        assert!(
            doc.items.iter().all(|i| i.summary_raw_text.is_some()),
            "summary must participate in each item"
        );
        let f = doc.items.iter().find(|i| i.item == "F").unwrap();
        assert_eq!(f.value, "permitted");
        assert_eq!(f.condition.as_deref(), Some("content_rating_required"));
        assert_eq!(
            doc.items
                .iter()
                .find(|i| i.item == "L")
                .unwrap()
                .condition
                .as_deref(),
            Some("between_users_only")
        );
        assert!(doc.licensor.as_ref().unwrap().contains("example.invalid"));
        assert_eq!(doc.hashtags, ["#SyntheticVN3"]);
        assert_eq!(doc.agreement_version.as_deref(), Some("0.42"));
    }
}
#[test]
fn lettered_paragraphs_in_special_notes_preserve_the_complete_original_note() {
    let note = "A. Keep the fictional blue emblem.\nW. Send a fictional postcard.\nX. Keep this last paragraph too.";
    let document = parsed(&EN.replace("Synthetic note: include the blue emblem.", note));
    assert_eq!(document.special_note.as_deref(), Some(note));
    assert_eq!(document.items[23].raw_text, note);
    assert_eq!(document.items[23].summary_raw_text.as_deref(), Some(note));
    assert!(!document.items[..23]
        .iter()
        .any(|item| item.value == "unknown"));
    assert!(!document.warnings.iter().any(|w| w.code == "duplicate_item"));
}

#[test]
fn unknown_wording_version_missing_items_and_summary_conflicts_never_become_permission() {
    let future = parsed(&EN.replace("generator version 1.10", "generator version 9.99"));
    assert_eq!(future.status, "unrecognized");
    assert!(future.items.is_empty());
    assert_eq!(future.generator_version.as_deref(), Some("9.99"));
    for future in [
        EN.replace("license version 1.10.", "license version 1.10.7."),
        JA.replace("ジェネレータVer.1.11", "ジェネレータVer.1.11.3"),
        EN.replace("generator version 1.10", "generator version 1.10-beta"),
    ] {
        assert_eq!(parsed(&future).status, "unrecognized");
    }
    let (summary, detail) = EN.split_once("Terms for particular cases").unwrap();
    let unknown = parsed(&format!(
        "{summary}Terms for particular cases{}",
        detail.replacen(
            "Permitted to use in activities with commercial or non-profit-seeking purposes",
            "Permitted while riding a fictional comet",
            1
        )
    ));
    assert_eq!(unknown.items[0].value, "unknown");
    assert!(unknown.items[0].raw_text.contains("fictional comet"));
    let conflict = parsed(&EN.replacen("Permitted (Content Rating is required)", "Prohibited", 1));
    assert_eq!(conflict.items[5].value, "unknown");
    assert!(conflict
        .warnings
        .iter()
        .any(|w| w.code == "summary_conflict" && w.item.as_deref() == Some("F")));
    let summary_unknown = parsed(&EN.replacen(
        "Permitted (Content Rating is required)",
        "Permitted while riding a fictional comet",
        1,
    ));
    assert_eq!(summary_unknown.items[5].value, "unknown");
    assert!(summary_unknown.items[5]
        .summary_raw_text
        .as_ref()
        .unwrap()
        .contains("fictional comet"));
    let start = detail.find("C. ").unwrap();
    let end = detail.find("D. ").unwrap();
    let missing = parsed(&format!(
        "{summary}Terms for particular cases{}{}",
        &detail[..start],
        &detail[end..]
    ));
    assert_eq!(missing.items[2].value, "unknown");
    assert!(missing
        .warnings
        .iter()
        .any(|w| w.code == "missing_item" && w.item.as_deref() == Some("C")));
}
#[test]
fn links_are_pure_canonical_and_limited_to_the_captured_description() {
    let html = r#"<a href="https://drive.google.com/file/d/outside/view">outside</a><div id="items"><article><div class="js-market-item-detail-description description"><a href="https://drive.google.com/file/d/shared/view?usp=sharing">Japanese license</a><a href="https://drive.google.com/file/d/shared/view">same file</a><a href="https://docs.google.com/spreadsheets/d/table/edit">table</a><a href="https://drive.google.com/drive/folders/folder">folder</a><a href="https://vn3.org/generator">VN3</a>https://docs.google.com/document/d/document/edit</div></article></div>"#;
    let links = terms_links::description_html_links(html).unwrap();
    assert_eq!(links.len(), 5);
    assert!(!links.iter().any(|l| l.source_id == "drive:outside"));
    assert_eq!(
        links.iter().filter(|l| l.google_file_id.is_some()).count(),
        2
    );
    assert_eq!(
        terms_links::recognize_link("https://drive.google.com/file/d/shared/view")
            .unwrap()
            .source_id,
        "drive:shared"
    );
    assert!(terms_links::recognize_link("https://evil@drive.google.com/file/d/id/view").is_none());
    assert_eq!(
        terms_links::recognize_link("https://drive.google.com.evil.invalid/file/d/id/view")
            .unwrap()
            .source_kind,
        "link"
    );
    assert!(terms_links::description_html_links("<div>missing markup</div>").is_none());
}

#[test]
fn seven_presets_preserve_conditions_notes_and_the_software_embedding_scope() {
    let store = BdlStore::open_in_memory().unwrap();
    product(&store, "booth:1", Some(""));
    attach(&store, "booth:1", "en", &parsed(EN));
    for (preset, expected) in [
        ("vrchat_personal", "conforms"),
        ("vtuber_individual", "conforms"),
        ("vtuber_corporate", "contact_licensor"),
        ("game_development", "contact_licensor"),
        ("outfit_for_sale", "conforms"),
        ("merchandise_publication", "conforms"),
        ("adult_content", "conforms"),
    ] {
        let check = terms::check_use(&store, preset, &["booth:1".into()]).unwrap();
        assert_eq!(check.combination.decision, expected, "{preset}");
        assert!(check.combination.has_special_note);
        assert!(check.combination.special_notes[0]
            .text
            .contains("blue emblem"));
        if preset == "adult_content" {
            assert!(check
                .combination
                .conditions
                .iter()
                .any(|c| c.condition == "content_rating_required"));
        }
        if preset == "game_development" {
            assert_eq!(
                check.combination.blocking_items[0].item.as_deref(),
                Some("R")
            );
            assert_eq!(check.combination.advisories[0].item.as_deref(), Some("N"));
            assert_eq!(
                check.combination.advisories[0].reason,
                "modified_asset_distribution_prohibited"
            );
        }
    }
}
#[test]
fn commercial_checks_keep_private_use_limits_and_require_explicit_personal_commercial_permission() {
    let store = BdlStore::open_in_memory().unwrap();
    let commercial =
        "Permitted to use in activities with commercial or non-profit-seeking purposes";
    product(&store, "booth:1", None);
    attach(
        &store,
        "booth:1",
        "private",
        &parsed(&EN.replace(
            "Publicizing for both commercial and non-profit-seeking purposes (including distribution and transmission) is permitted",
            "Permitted to use in private and personal arena only",
        )),
    );
    let outfit = terms::check_use(&store, "outfit_for_sale", &["booth:1".into()]).unwrap();
    assert_eq!(outfit.combination.decision, "nonconforming");
    assert!(outfit
        .combination
        .blocking_items
        .iter()
        .any(|i| i.item.as_deref() == Some("S") && i.reason == "commercial_use_not_permitted"));
    assert!(outfit
        .combination
        .conditions
        .iter()
        .any(|i| i.condition == "private_use_only"));
    assert_eq!(
        terms::check_use(&store, "vrchat_personal", &["booth:1".into()])
            .unwrap()
            .combination
            .decision,
        "conforms"
    );
    product(&store, "booth:2", None);
    attach(
        &store,
        "booth:2",
        "unspecified-commercial",
        &parsed(&EN.replace(commercial, "Permitted")),
    );
    let vtuber = terms::check_use(&store, "vtuber_individual", &["booth:2".into()]).unwrap();
    assert_eq!(vtuber.combination.decision, "unknown");
    assert!(vtuber.matching_product_ids.is_empty());
    assert!(vtuber
        .combination
        .blocking_items
        .iter()
        .any(|i| i.item.as_deref() == Some("A") && i.reason == "commercial_permission_unknown"));
}

#[test]
fn combinations_take_the_strictest_item_and_unknown_is_never_a_match() {
    let store = BdlStore::open_in_memory().unwrap();
    for id in ["booth:1", "booth:2", "booth:3"] {
        product(&store, id, None);
    }
    attach(&store, "booth:1", "first", &parsed(EN));
    let mut blocked = parsed(EN);
    blocked.items[2].value = "prohibited".into();
    attach(&store, "booth:2", "second", &blocked);
    let result = terms::check_use(
        &store,
        "vrchat_personal",
        &["booth:1".into(), "booth:2".into(), "booth:3".into()],
    )
    .unwrap();
    assert_eq!(result.combination.decision, "nonconforming");
    assert_eq!(result.matching_product_ids, ["booth:1"]);
    assert_eq!(result.products[2].result.decision, "unknown");
    assert!(result
        .combination
        .blocking_items
        .iter()
        .any(|b| b.item.as_deref() == Some("C")));
    let unknown = terms::check_use(&store, "adult_content", &["booth:3".into()]).unwrap();
    assert!(unknown.matching_product_ids.is_empty());
    assert_eq!(unknown.combination.decision, "unknown");
}
#[test]
fn japanese_selection_and_bilingual_conflicts_retain_both_sources() {
    let store = BdlStore::open_in_memory().unwrap();
    product(&store, "booth:1", Some(""));
    attach(&store, "booth:1", "english", &parsed(EN));
    let japanese = parsed(&JA.replace("許可します(ただし棲み分けはおこなうこと)", "許可しません"));
    attach(&store, "booth:1", "japanese", &japanese);
    let result = terms::product_detail(&store, "booth:1").unwrap();
    assert_eq!(result.effective_language.as_deref(), Some("ja"));
    assert_eq!(result.effective_items[5].value, "unknown");
    assert_eq!(result.product.sources.len(), 2);
    assert!(result
        .warnings
        .iter()
        .any(|w| w.code == "language_conflict" && w.item.as_deref() == Some("F")));
    assert_eq!(
        terms::check_use(&store, "adult_content", &["booth:1".into()])
            .unwrap()
            .combination
            .decision,
        "unknown"
    );
}

fn pdf(text: &str) -> Vec<u8> {
    use pdf_extract::{
        content::{Content, Operation},
        dictionary, Document, Object, Stream,
    };
    let mut doc = Document::with_version("1.4");
    let pages = doc.new_object_id();
    let font=doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica","Encoding"=>"WinAnsiEncoding"});
    let resources = doc.add_object(dictionary! {"Font"=>dictionary!{"F1"=>font}});
    let mut operations = vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec!["F1".into(), 10.into()]),
        Operation::new("Td", vec![20.into(), 9000.into()]),
    ];
    for line in text.lines() {
        let encoded: Vec<u8> = line
            .chars()
            .map(|c| match c {
                '“' => 0x93,
                '”' => 0x94,
                _ if c.is_ascii() => c as u8,
                _ => b'?',
            })
            .collect();
        operations.push(Operation::new("Tj", vec![Object::string_literal(encoded)]));
        operations.push(Operation::new("Td", vec![0.into(), (-12).into()]));
    }
    operations.push(Operation::new("ET", vec![]));
    let content = doc.add_object(Stream::new(
        dictionary! {},
        Content { operations }.encode().unwrap(),
    ));
    let page=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages,"Contents"=>content,"Resources"=>resources,"MediaBox"=>vec![0.into(),0.into(),2000.into(),10000.into()]});
    doc.objects.insert(
        pages,
        dictionary! {"Type"=>"Pages","Kids"=>vec![page.into()],"Count"=>1}.into(),
    );
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages});
    doc.trailer.set("Root", catalog);
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}
#[test]
fn locally_generated_pdf_has_extractable_text_and_blank_or_invalid_pdf_is_unsupported() {
    let bytes = pdf("Synthetic local PDF text");
    assert!(vn3::extract_pdf(&bytes)
        .unwrap()
        .contains("Synthetic local PDF text"));
    assert_eq!(
        vn3::extract_pdf_cancellable(&bytes, &|| true).unwrap_err(),
        "cancelled"
    );
    assert_eq!(vn3::extract_pdf(&pdf("")).unwrap_err(), "no_text_layer");
    assert!(vn3::extract_pdf(b"%PDF-broken").is_err());
    let mut encrypted = pdf_extract::Document::load_mem(&bytes).unwrap();
    encrypted.trailer.set("Encrypt",pdf_extract::dictionary!{"Filter"=>"Standard","V"=>1,"R"=>2,"Length"=>40,"O"=>pdf_extract::Object::string_literal(vec![0;32]),"U"=>pdf_extract::Object::string_literal(vec![0;32]),"P"=>-4});
    let mut bytes = Vec::new();
    encrypted.save_to(&mut bytes).unwrap();
    assert!(vn3::extract_pdf(&bytes).is_err());
}

#[test]
fn deeply_nested_pdf_is_rejected_without_aborting_the_terms_reader() {
    let mut bytes = b"%PDF-1.4\n".to_vec();
    let catalog_offset = bytes.len();
    bytes.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R /X ");
    bytes.extend_from_slice(&[b'['; 10_000]);
    bytes.extend_from_slice(b"0");
    bytes.extend_from_slice(&[b']'; 10_000]);
    bytes.extend_from_slice(b" >>\nendobj\n");
    let pages_offset = bytes.len();
    bytes.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n");
    let xref_offset = bytes.len();
    bytes.extend_from_slice(
        format!(
            "xref\n0 3\n0000000000 65535 f \n{catalog_offset:010} 00000 n \n{pages_offset:010} 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
        )
        .as_bytes(),
    );
    assert!(vn3::extract_pdf(&bytes).is_err());
}

struct Transport {
    bytes: Vec<u8>,
    calls: AtomicUsize,
    hold: AtomicBool,
}
impl TermsTransport for Transport {
    fn fetch(&self, _: &TermsLink, cancelled: &(dyn Fn() -> bool + Send + Sync)) -> FetchOutcome {
        self.calls.fetch_add(1, Ordering::SeqCst);
        while self.hold.load(Ordering::SeqCst) {
            if cancelled() {
                return FetchOutcome::Cancelled;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        FetchOutcome::Pdf(self.bytes.clone())
    }
}
fn wait(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while !condition() {
        assert!(Instant::now() < deadline, "task did not settle");
        std::thread::sleep(Duration::from_millis(5));
    }
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vua-vn3-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        assert!(
            self.0.starts_with(std::env::temp_dir())
                && self
                    .0
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("vua-vn3-")
        );
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn refresh_is_durable_idempotent_cancellable_and_reuses_the_content_cache() {
    let root = Temp::new();
    let bdl = Arc::new(BdlStore::open_in_memory().unwrap());
    for id in ["booth:1", "booth:2"] {
        product(
            &bdl,
            id,
            Some("https://drive.google.com/file/d/synthetic/view"),
        );
    }
    let tasks = Arc::new(SqliteTaskStore::open_in_memory().unwrap());
    let runtime = TaskRuntime::with_sqlite(
        tasks.clone(),
        Arc::new(FixedClock::new(&[NOW])),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    let transport = Arc::new(Transport {
        bytes: pdf(EN),
        calls: AtomicUsize::new(0),
        hold: AtomicBool::new(true),
    });
    let service = Arc::new(TermsService::new(
        bdl.clone(),
        runtime.clone(),
        root.0.join("terms"),
        transport.clone(),
        Arc::new(FixedClock::new(&[NOW])),
    ));
    let first = service.submit(Some("booth:1"), "test", "once").unwrap();
    let first_id = first["taskId"].as_str().unwrap();
    wait(|| transport.calls.load(Ordering::SeqCst) == 1);
    assert_eq!(
        service.submit(Some("booth:1"), "replay", "once").unwrap(),
        first
    );
    assert_eq!(
        service
            .submit(Some("booth:2"), "conflict", "once")
            .unwrap_err()
            .code,
        "vua.task.idempotency_conflict"
    );
    let queued = service.submit(Some("booth:1"), "queued", "queued").unwrap();
    let queued_id = queued["taskId"].as_str().unwrap();
    runtime.cancel(queued_id).unwrap();
    transport.hold.store(false, Ordering::SeqCst);
    wait(|| tasks.task(first_id).unwrap().unwrap().state.is_terminal());
    wait(|| tasks.task(queued_id).unwrap().unwrap().state.is_terminal());
    assert_eq!(
        tasks.task(queued_id).unwrap().unwrap().state,
        TaskState::Cancelled
    );
    assert_eq!(transport.calls.load(Ordering::SeqCst), 1);
    assert_eq!(bdl.product_terms("booth:1").unwrap().state, "parsed");
    let second = service.submit(Some("booth:1"), "again", "again").unwrap();
    let second_id = second["taskId"].as_str().unwrap();
    wait(|| tasks.task(second_id).unwrap().unwrap().state.is_terminal());
    let row = tasks.task(second_id).unwrap().unwrap();
    assert_eq!(row.result.unwrap()["cachedDocuments"], 1);
    assert_eq!(transport.calls.load(Ordering::SeqCst), 2);
    let result = service
        .check_use("adult_content", &["booth:1".into()])
        .unwrap();
    assert_eq!(result.combination.decision, "conforms");
    assert!(result.combination.has_special_note);
    let library = service.submit(None, "library", "library").unwrap();
    let library_id = library["taskId"].as_str().unwrap();
    wait(|| tasks.task(library_id).unwrap().unwrap().state.is_terminal());
    assert_eq!(
        tasks.task(library_id).unwrap().unwrap().result.unwrap()["processedProducts"],
        2
    );
    assert_eq!(
        transport.calls.load(Ordering::SeqCst),
        3,
        "shared Google file fetched once per library task"
    );
}
