use crate::{layout::Installation, manifest::*, paths::*, transfer::Transfer};
use ed25519_dalek::{Signer, SigningKey};
use std::{
    fs,
    io::Write,
    sync::{atomic::AtomicBool, Arc},
};
fn pack(files: &[(&str, &[u8])]) -> (Vec<FileObject>, Vec<u8>, Pack) {
    let mut data = Vec::new();
    let mut inventory = Vec::new();
    for (path, bytes) in files {
        inventory.push(FileObject {
            path: (*path).into(),
            bytes: bytes.len() as u64,
            sha256: digest(bytes),
            offset: data.len() as u64,
        });
        data.extend_from_slice(bytes);
    }
    let pack = Pack {
        bytes: data.len() as u64,
        sha256: digest(&data),
        sources: vec!["https://example.test/component.bin".into()],
    };
    (inventory, data, pack)
}
fn fixture(input: &std::path::Path) -> (Manifest, Vec<u8>, [u8; 32]) {
    fs::create_dir_all(input).unwrap();
    let (host_files, host_bytes, host_pack) = pack(&[
        ("dist/electron/main.js", b"main"),
        ("dist/electron/preload.js", b"preload"),
        ("dist/renderer/index.html", b"host"),
        ("provider/vua-orchestrator-provider.exe", b"host-exe"),
        ("bootstrap/app.asar", b"bootstrap"),
    ]);
    let (amf_files, amf_bytes, amf_pack) = pack(&[
        ("ui/amf-entry.js", b"module"),
        ("ui/style.css", b"style"),
        ("provider/vua-amf-provider.exe", b"amf-exe"),
    ]);
    let runtime_data = [
        ("electron.exe", &b"electron"[..]),
        ("resources/default_app.asar", &b"default"[..]),
        ("LICENSE", &b"mit"[..]),
        ("LICENSES.chromium.html", &b"chromium"[..]),
    ];
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in runtime_data {
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    let runtime_bytes = writer.finish().unwrap().into_inner();
    let (runtime_files, _, _) = pack(&runtime_data);
    let manifest = Manifest {
        schema_version: "0.1".into(),
        product: "VUA".into(),
        platform: "windows".into(),
        arch: "x64".into(),
        release_version: "0.6.7".into(),
        release_url: "https://github.com/VUA-Project/VUA/releases/tag/v0.6.7".into(),
        runtime: Runtime {
            version: "44.1.1".into(),
            files: runtime_files,
            archive: Pack {
                bytes: runtime_bytes.len() as u64,
                sha256: digest(&runtime_bytes),
                sources: vec!["https://example.test/runtime.zip".into()],
            },
        },
        host: Component {
            version: "0.6.7".into(),
            build: "a".repeat(40),
            files: host_files,
            pack: host_pack,
        },
        amf: Component {
            version: "0.1.0".into(),
            build: "a".repeat(40),
            files: amf_files,
            pack: amf_pack,
        },
        compatibility: Compatibility {
            host: ">=0.6.7, <0.7.0".into(),
            ui_abi: UI_ABI.into(),
            react: "19.2.8".into(),
            application: "0.1".into(),
            bridge: "0.1".into(),
            bdl_write: "0.10".into(),
            bdl_read: vec!["0.10".into()],
        },
    };
    fs::write(input.join("host.bin"), host_bytes).unwrap();
    fs::write(input.join("amf.bin"), amf_bytes).unwrap();
    fs::write(input.join("runtime.zip"), runtime_bytes).unwrap();
    let (raw, key) = signed(&manifest);
    (manifest, raw, key)
}
fn signed(manifest: &Manifest) -> (Vec<u8>, [u8; 32]) {
    let key = SigningKey::from_bytes(&[7; 32]);
    let payload = serde_json::to_string(manifest).unwrap();
    let raw = serde_json::to_vec(&SignedManifest {
        schema_version: "0.1".into(),
        algorithm: "ed25519".into(),
        signature: hex(&key.sign(payload.as_bytes()).to_bytes()),
        payload,
    })
    .unwrap();
    (raw, key.verifying_key().to_bytes())
}
fn transfer() -> Transfer {
    Transfer::new(Arc::new(AtomicBool::new(false)), |_| {}).unwrap()
}

#[tokio::test]
async fn mirrored_feeds_authenticate_both_and_select_the_newer_release_or_amf() {
    use crate::feed::{latest_manifest, select_manifest};
    use std::sync::atomic::Ordering;
    let temp = tempfile::tempdir().unwrap();
    let (mut manifest, old, key) = fixture(temp.path());
    manifest.amf.version = "0.1.1".into();
    let (module, _) = signed(&manifest);
    assert_eq!(
        select_manifest([Ok(old.clone()), Ok(module.clone())], &key)
            .unwrap()
            .raw,
        module
    );
    manifest.release_version = "0.6.8".into();
    manifest.host.version = "0.6.8".into();
    manifest.release_url = "https://github.com/VUA-Project/VUA/releases/tag/v0.6.8".into();
    let (new, _) = signed(&manifest);
    assert_eq!(
        select_manifest([Ok(module), Ok(new.clone())], &key)
            .unwrap()
            .raw,
        new
    );
    assert_eq!(
        select_manifest([Ok(new.clone()), Ok(old.clone())], &key)
            .unwrap()
            .raw,
        new
    );
    let mut tampered = new.clone();
    let position = tampered.iter().position(|byte| *byte == b'6').unwrap();
    tampered[position] = b'9';
    assert_eq!(
        select_manifest([Ok(tampered.clone()), Ok(old.clone())], &key)
            .unwrap()
            .raw,
        old
    );
    assert!(select_manifest([Ok(tampered), Err(crate::Error("offline".into()))], &key).is_err());
    assert_eq!(
        select_manifest([Err(crate::Error("offline".into())), Ok(new.clone())], &key)
            .unwrap()
            .raw,
        new
    );
    let (first_url, _, first_stop, first_server) = server(old, false, false);
    let (second_url, _, second_stop, second_server) = server(new.clone(), false, false);
    let cancel = Arc::new(AtomicBool::new(false));
    let transfer = Transfer::loopback(cancel.clone(), |_| {});
    let selected = latest_manifest(&transfer, [&first_url, &second_url], &key)
        .await
        .unwrap();
    cancel.store(true, Ordering::Relaxed);
    let cancelled = latest_manifest(&transfer, [&first_url, &second_url], &key).await;
    first_stop.store(true, Ordering::Relaxed);
    second_stop.store(true, Ordering::Relaxed);
    first_server.join().unwrap();
    second_server.join().unwrap();
    assert_eq!(selected.raw, new);
    assert!(!selected.official);
    assert_eq!(selected.release_page(&manifest), manifest.release_url);
    let official = select_manifest(
        [
            Ok(selected.raw.clone()),
            Err(crate::Error("offline".into())),
        ],
        &key,
    )
    .unwrap();
    assert!(official.official);
    assert_eq!(
        official.release_page(&manifest),
        "https://ph-r.com/vua/releases/v0.6.8/"
    );
    let tied = select_manifest([Ok(new.clone()), Ok(new.clone())], &key).unwrap();
    assert!(tied.official);
    let fallback = select_manifest([Err(crate::Error("offline".into())), Ok(new)], &key).unwrap();
    assert!(!fallback.official);
    assert_eq!(fallback.release_page(&manifest), manifest.release_url);
    assert_eq!(cancelled.unwrap_err().0, "cancelled");
}
fn server(
    data: Vec<u8>,
    ignore_range: bool,
    slow: bool,
) -> (
    String,
    Arc<std::sync::atomic::AtomicU64>,
    Arc<AtomicBool>,
    std::thread::JoinHandle<()>,
) {
    use std::io::Read;
    use std::sync::atomic::{AtomicU64, Ordering};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/object.bin", listener.local_addr().unwrap());
    let bytes = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let sent = bytes.clone();
    let exit = stop.clone();
    let handle = std::thread::spawn(move || {
        while !exit.load(Ordering::Relaxed) {
            if let Ok((mut socket, _)) = listener.accept() {
                // Windows can inherit the listener's nonblocking mode. Read the
                // complete bounded request before interpreting its Range header.
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 2048];
                while let Ok(count) = socket.read(&mut chunk) {
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..count]);
                    if request.windows(4).any(|value| value == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let range = request
                    .lines()
                    .find_map(|line| line.strip_prefix("range: bytes="));
                let (start, end, partial) = if let Some(range) = range.filter(|_| !ignore_range) {
                    let (start, end) = range.split_once('-').unwrap();
                    (
                        start.parse::<usize>().unwrap(),
                        end.parse::<usize>()
                            .unwrap_or(data.len() - 1)
                            .min(data.len() - 1),
                        true,
                    )
                } else {
                    (0, data.len() - 1, false)
                };
                let body = &data[start..=end];
                let headers = format!(
                    "HTTP/1.1 {}\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
                    if partial {
                        "206 Partial Content"
                    } else {
                        "200 OK"
                    },
                    body.len(),
                    if partial {
                        format!("Content-Range: bytes {start}-{end}/{}\r\n", data.len())
                    } else {
                        String::new()
                    }
                );
                let _ = socket.write_all(headers.as_bytes());
                if slow {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
                if socket.write_all(body).is_ok() {
                    sent.fetch_add(body.len() as u64, Ordering::Relaxed);
                }
            } else {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    });
    (url, bytes, stop, handle)
}
#[tokio::test]
async fn range_updates_download_only_changed_files_and_full_fallback_is_visible() {
    use std::sync::atomic::Ordering;
    for fallback in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        let next = temp.path().join("next");
        fs::create_dir(&old).unwrap();
        fs::write(old.join("unchanged"), b"same").unwrap();
        fs::write(old.join("changed"), b"old").unwrap();
        let (files, data, mut pack) = pack(&[("unchanged", b"same"), ("changed", b"new-version")]);
        let (source, bytes, stop, server) = server(data, fallback, false);
        pack.sources = vec![source];
        let progress = Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed = progress.clone();
        let mut transfer = Transfer::loopback(Arc::new(AtomicBool::new(false)), move |value| {
            observed.lock().unwrap().push(value)
        });
        transfer
            .component(
                &files,
                &pack,
                Some(&old),
                &next,
                None,
                &temp.path().join("pack.bin"),
            )
            .await
            .unwrap();
        stop.store(true, Ordering::Relaxed);
        server.join().unwrap();
        assert_eq!(fs::read(next.join("changed")).unwrap(), b"new-version");
        assert_eq!(fs::read(next.join("unchanged")).unwrap(), b"same");
        if !fallback {
            assert_eq!(bytes.load(Ordering::Relaxed), 11);
        } else {
            assert!(progress.lock().unwrap().iter().any(|p| p.full_pack));
        }
    }
}
#[tokio::test]
async fn cancellation_interrupts_a_waiting_network_body_without_activating_it() {
    use std::sync::atomic::Ordering;
    let (url, _, stop, server) = server(b"new-version".to_vec(), false, true);
    let temp = tempfile::tempdir().unwrap();
    let (files, _, mut pack) = pack(&[("changed", b"new-version")]);
    pack.sources = vec![url];
    let cancel = Arc::new(AtomicBool::new(false));
    let requested = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        requested.store(true, Ordering::Relaxed);
    });
    let mut transfer = Transfer::loopback(cancel, |_| {});
    let start = std::time::Instant::now();
    let error = transfer
        .component(
            &files,
            &pack,
            None,
            &temp.path().join("next"),
            None,
            &temp.path().join("pack.bin"),
        )
        .await
        .unwrap_err();
    assert_eq!(error.0, "cancelled");
    // Below the loopback client's 2 s read timeout, so the waiting body was interrupted rather
    // than timed out; the margin absorbs scheduling on shared CI runners.
    assert!(start.elapsed() < std::time::Duration::from_millis(1_500));
    stop.store(true, Ordering::Relaxed);
    server.join().unwrap();
}
#[test]
fn schema_vectors_and_javascript_signature_agree_with_the_native_consumer() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/windows-distribution/v0.1");
    let cases: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("vectors/cases.json")).unwrap()).unwrap();
    let key = SigningKey::from_bytes(&[7; 32]).verifying_key().to_bytes();
    for case in cases.as_array().unwrap() {
        let schema: serde_json::Value = serde_json::from_slice(
            &fs::read(root.join(format!("{}.schema.json", case["schema"].as_str().unwrap())))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            jsonschema::validator_for(&schema)
                .unwrap()
                .is_valid(&case["value"]),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        if case["name"] == "signed-test-key" {
            assert!(verify(&serde_json::to_vec(&case["value"]).unwrap(), &key).is_ok());
        }
    }
}
#[test]
fn signatures_and_complete_layout_are_required() {
    let temp = tempfile::tempdir().unwrap();
    let (mut manifest, raw, key) = fixture(&temp.path().join("input"));
    assert!(verify(&raw, &key).is_ok());
    assert!(verify(&raw, &[0; 32]).is_err());
    let mut tampered: SignedManifest = serde_json::from_slice(&raw).unwrap();
    tampered.payload.push(' ');
    assert_eq!(
        verify(&serde_json::to_vec(&tampered).unwrap(), &key)
            .unwrap_err()
            .0,
        "invalid_release_signature"
    );
    manifest.amf.files.pop();
    let (raw, _) = signed(&manifest);
    assert!(verify(&raw, &key).is_err());
}
#[test]
fn paths_ranges_sources_and_compatibility_reject_bad_inputs() {
    for path in [
        "../file",
        "a/../b",
        "c:/file",
        "\\server\\share",
        "a//b",
        "CON.txt",
        "folder/NUL",
        "x.",
        "x ",
        "a:b",
        "folder/./x",
    ] {
        assert!(!relative_name(path), "{path}");
    }
    assert!(relative_name("ui/素材-1.png"));
    let temp = tempfile::tempdir().unwrap();
    let (manifest, _, _) = fixture(&temp.path().join("input"));
    let mut bad = manifest.clone();
    bad.amf.files[0].offset = 1;
    assert!(bad.validate().is_err());
    let mut bad = manifest.clone();
    bad.amf.files[1].path = bad.amf.files[0].path.to_ascii_uppercase();
    assert!(bad.validate().is_err());
    let mut bad = manifest.clone();
    bad.runtime.archive.sources = vec!["http://example.test/file".into()];
    assert!(bad.validate().is_err());
    let mut bad = manifest.clone();
    bad.compatibility.react = "20.0.0".into();
    assert!(bad.compatible_amf(&manifest).is_err());
    let mut bad = manifest.clone();
    bad.compatibility.host = ">=0.7.0".into();
    assert!(bad.compatible_amf(&manifest).is_err());
}
#[test]
fn root_ownership_marker_order_and_atomic_replacement() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("owned");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("unrelated"), b"user").unwrap();
    assert!(Installation::open(&root, true).is_err());
    fs::remove_file(root.join("unrelated")).unwrap();
    let _installation = Installation::open(&root, true).unwrap();
    assert!(Installation::open(&root, false).is_ok());
    fs::write(
        root.join("vua-installation.json"),
        br#"{"product":"VUA","schemaVersion":"0.1"}"#,
    )
    .unwrap();
    assert!(Installation::open(&root, false).is_ok());
    let pointer = root.join("pointer.json");
    atomic_json(&pointer, &1).unwrap();
    atomic_json(&pointer, &2).unwrap();
    assert_eq!(fs::read(pointer).unwrap(), b"2");
}
#[tokio::test]
async fn offline_install_reuse_corruption_repair_and_owned_removal() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("input");
    let (manifest, raw, key) = fixture(&input);
    let installation = Installation::with_key(&temp.path().join("installed"), true, key).unwrap();
    installation
        .install(&raw, &input, &mut transfer())
        .await
        .unwrap();
    let active = fs::read(installation.root.join("active.json")).unwrap();
    installation
        .install(&raw, &input, &mut transfer())
        .await
        .unwrap();
    assert_eq!(
        active,
        fs::read(installation.root.join("active.json")).unwrap()
    );
    let runtime = installation.runtime_root(&manifest).unwrap();
    fs::write(runtime.join("electron.exe"), b"corrupt").unwrap();
    installation
        .install(&raw, &input, &mut transfer())
        .await
        .unwrap();
    assert_eq!(fs::read(runtime.join("electron.exe")).unwrap(), b"electron");
    assert_eq!(
        fs::read(runtime.join("VUA.Runtime.exe")).unwrap(),
        b"electron"
    );
    let unrelated = temp.path().join("user-library");
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("paid-asset"), b"private").unwrap();
    installation.remove().unwrap();
    assert!(unrelated.join("paid-asset").exists());
    assert!(!installation.root.join("payloads").exists());
}
#[tokio::test]
async fn cancelled_stage_and_unsigned_feed_do_not_replace_active_payload() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("input");
    let (mut target, raw, key) = fixture(&input);
    let installation = Installation::with_key(&temp.path().join("installed"), true, key).unwrap();
    installation
        .install(&raw, &input, &mut transfer())
        .await
        .unwrap();
    let before = fs::read(installation.root.join("active.json")).unwrap();
    target.amf.version = "0.1.1".into();
    let (raw, _) = signed(&target);
    let mut cancelled = Transfer::new(Arc::new(AtomicBool::new(true)), |_| {}).unwrap();
    assert_eq!(
        installation
            .stage_amf(&raw, &mut cancelled)
            .await
            .unwrap_err()
            .0,
        "cancelled"
    );
    assert_eq!(
        before,
        fs::read(installation.root.join("active.json")).unwrap()
    );
    assert_eq!(
        installation.pending().unwrap().unwrap().state,
        "interrupted"
    );
    assert!(installation
        .stage_amf(b"{}", &mut transfer())
        .await
        .is_err());
    assert_eq!(
        before,
        fs::read(installation.root.join("active.json")).unwrap()
    );
    installation.stage_amf(&raw, &mut transfer()).await.unwrap();
    assert_eq!(installation.pending().unwrap().unwrap().state, "staged");
    assert_eq!(
        installation.activate().unwrap_err().0,
        "activation_requires_choice"
    );
    installation.request_activation().unwrap();
    installation.activate().unwrap();
    assert_eq!(installation.snapshot().unwrap().amf_version, "0.1.1");
    installation.rollback().unwrap();
    assert_eq!(installation.snapshot().unwrap().amf_version, "0.1.0");
}
#[tokio::test]
async fn running_installation_and_incompatible_data_block_changes() {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("input");
    let (mut manifest, raw, key) = fixture(&input);
    let installation = Installation::with_key(&temp.path().join("installed"), true, key).unwrap();
    installation
        .install(&raw, &input, &mut transfer())
        .await
        .unwrap();
    let running = installation.lock("running.lock").unwrap();
    assert_eq!(
        installation
            .install(&raw, &input, &mut transfer())
            .await
            .unwrap_err()
            .0,
        "installation_busy"
    );
    assert_eq!(installation.remove().unwrap_err().0, "installation_busy");
    drop(running);
    manifest.amf.version = "0.1.1".into();
    manifest.compatibility.bdl_read = vec!["0.11".into()];
    manifest.compatibility.bdl_write = "0.11".into();
    let (raw, _) = signed(&manifest);
    assert_eq!(
        installation
            .stage_amf(&raw, &mut transfer())
            .await
            .unwrap_err()
            .0,
        "unsupported_data_migration"
    );
    assert_eq!(installation.snapshot().unwrap().amf_version, "0.1.0");
}
