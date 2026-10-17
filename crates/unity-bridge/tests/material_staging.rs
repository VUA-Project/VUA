
#[test]
fn staged_project_bundles_the_bridge_scaffold_by_default() {
    let temp = std::env::temp_dir().join(format!(
        "vua-staging-scaffold-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let staging = vua_unity_bridge::StagingProject::create(&temp, "sess", "token")
        .expect("staging creates");
    let packages = staging.root().join("Packages");

    // The production default must be able to execute Bridge commands: the
    // entry point package and the MA compile stub its asmdef references
    // are both present without any harness override.
    assert!(packages.join("com.ph-r.vua/package.json").is_file());
    assert!(
        packages
            .join("com.ph-r.vua/Editor/Bridge/BridgeEntryPoint.cs")
            .is_file()
    );
    assert!(packages.join("nadena.dev.modular-avatar.core/package.json").is_file());
    let stub: String =
        std::fs::read_to_string(packages.join("nadena.dev.modular-avatar.core/package.json")).unwrap();
    assert!(stub.contains("0.0.0-stub"));
    // Real production entry points must not compile against synthetic MA stubs.
    assert!(!packages.join("com.ph-r.vua/Editor/Amf/AmfProductionEntryPoint.cs").exists());

    // Every Bridge source and GUID must reach staging, including helper files
    // referenced by the entry point/processor. A partial package cannot compile.
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../unity/Packages/com.ph-r.vua/Editor/Bridge");
    for entry in std::fs::read_dir(source).unwrap() {
        let path = entry.unwrap().path();
        if path.is_file() {
            let bundled = packages.join("com.ph-r.vua/Editor/Bridge").join(path.file_name().unwrap());
            assert_eq!(std::fs::read(&bundled).expect("complete Bridge scaffold"),
                std::fs::read(&path).unwrap(), "{}", bundled.display());
        }
    }

    staging.destroy().unwrap();
    let _ = std::fs::remove_dir_all(&temp);
}

/// 第 183 批反向审查（#43 路径形态族成员钉死）：staging 目录名内插的
/// session_id 在生产 wire 上是客户端可控的确认 correlationId。含路径分隔
/// 符、`..`、盘符/verbatim 前缀、空白或超长的 id 必须在任何目录创建之前
/// 被拒绝——错误只携带长度，宿敌值不回流进收据或日志。
#[test]
fn staging_root_rejects_path_hostile_session_ids_before_any_filesystem_write() {
    let temp = std::env::temp_dir().join(format!(
        "vua-staging-guard-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let hostile = [
        "../evil",
        "a/b",
        "a\\b",
        "C:\\evil",
        "\\\\?\\C:\\evil",
        "id with spaces",
        "",
        "con\t",
        &"x".repeat(129),
    ];
    for session_id in hostile {
        let computed = vua_unity_bridge::staging_root(&temp, session_id);
        assert!(computed.is_err(), "hostile id accepted: {session_id:?}");
        let message = computed.err().unwrap().to_string();
        assert!(
            !message.contains(session_id) || session_id.is_empty(),
            "error must not echo the rejected value: {message}"
        );
        // Rejection happens BEFORE any directory is created: neither the
        // staging root, its temp parent, nor any escaped target exists.
        assert!(!temp.exists(), "guard must fire before filesystem writes");
        let project = vua_unity_bridge::StagingProject::create(&temp, session_id, "token");
        assert!(project.is_err(), "create must propagate the guard: {session_id:?}");
        assert!(!temp.exists(), "create must not touch the filesystem");
    }
    let _ = std::fs::remove_dir_all(&temp);
}

/// 合法词面放行：现网全部身份形态（uuid-v7、`task-*`、`material-<hex>`、
/// 测试用短 id）都满足守卫闭集——守卫只挡路径敌意形态，不断真实链路。
#[test]
fn staging_root_accepts_provider_shaped_session_ids() {
    let temp = std::env::temp_dir().join(format!(
        "vua-staging-accept-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let legit = [
        "corr",
        "sess",
        "018f3c2e-7d1a-7b3e-9f2a-3c4d5e6f7a8b",
        "task-1790000000000-0002",
        "material-0123456789abcdef01234567",
        &"y".repeat(128),
    ];
    for session_id in legit {
        let computed = vua_unity_bridge::staging_root(&temp, session_id)
            .expect("legit provider-shaped id must pass the guard");
        assert!(computed.starts_with(&temp));
        assert!(!computed.to_string_lossy().contains('/'), "single component under temp root");
    }
    let _ = std::fs::remove_dir_all(&temp);
}
