//! Production-job executor prelude (unity-bridge v2 proposal 009 / W21;
//! **production face migrated to v3** in the 2026-09-13 production-face
//! migration slice).
//!
//! The approved plan travels as a job-directory file (009 ruling): the
//! provider-side executor writes it next to the bridge request file and pins
//! its SHA-256 into the command; the C# Bridge reads the file and verifies
//! the hash locally before executing (integrity never rests on provider
//! honesty alone).
//!
//! v3 is a frozen same-face superset of v2 (proposal 016): the production
//! operations (`execute_production_job` / `restore_project`) keep every
//! field, constraint, and receipt semantic — only `schemaVersion` moves 2→3,
//! which also legalizes `data.instanceGlobalObjectId` (proposal 011 success
//! criterion) and retires the JsonUtility empty-string drift into frozen v2
//! receipts. The v2 face stays frozen with all its vectors valid; the
//! receipt parser keeps accepting v2 documents for the transition window and
//! rejects everything else.
//!
//! The command envelope itself (`UnityOperation` / `UnityPayload` /
//! `UnityResult`) is core-owned; this module ships the parts that do not
//! depend on those types — the plan file + hash anchor and the typed
//! projection of the job receipt.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use vua_orchestrator::{UnityCommand, UnityOperation, UnityPayload};

use std::fs;
use std::path::{Path, PathBuf};

/// The staged material for one install job: the extracted guid layout plus
/// its manifest digest, exactly what the C# `materialize_extracted_package`
/// base consumes (v1-verified semantics).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedSource {
    pub source_package_path: String,
    pub manifest_sha256: String,
}

/// Stages an original-package source for one install job (009 execution
/// spec, kind 1): verifies the archive against the plan's resolved
/// `artifactSha256` (source integrity), extracts the guid layout under
/// `.vua/imports/prodjob-<command_id>/`, and binds the manifest's own digest.
/// The generated_vpm path copies the materialized copy directory instead —
/// its Bridge-side consumption form is pending the core refinement and is
/// NOT covered here (declared gap, see wt-4 state file).
pub fn stage_original_source(
    archive_path: &Path,
    project_root: &Path,
    command_id: &str,
    expected_artifact_sha256: &str,
) -> Result<StagedSource, PlanFileError> {
    if command_id.is_empty()
        || command_id.len() > 128
        || command_id == "."
        || command_id == ".."
        || command_id.ends_with(['.', ' '])
        || command_id.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
        })
    {
        return Err(PlanFileError("command_id 非法或为空".to_string()));
    }
    let archive_digest = crate::material_exec::sha256_file(archive_path)
        .map_err(|error| PlanFileError(format!("来源物读取失败：{error}")))?;
    if archive_digest != expected_artifact_sha256 {
        return Err(PlanFileError(format!(
            "来源物哈希漂移（期望 {expected_artifact_sha256}，实际 {archive_digest}）"
        )));
    }
    let extracted_root = project_root
        .join(".vua")
        .join("imports")
        .join(format!("prodjob-{command_id}"));
    crate::material_exec::extract_package_into_dir(archive_path, &extracted_root)
        .map_err(|error| PlanFileError(format!("来源物解包失败：{error}")))?;
    let manifest_sha256 =
        crate::material_exec::sha256_file(&extracted_root.join("manifest.sha256"))
            .map_err(|error| PlanFileError(format!("manifest 摘要计算失败：{error}")))?;
    Ok(StagedSource {
        source_package_path: extracted_root.to_string_lossy().into_owned(),
        manifest_sha256,
    })
}

/// The plan document must declare a supported schema version before it is
/// written into a job directory; the same closed set lives in the frozen
/// command schemas (`planSchemaVersion` enum, v2 and v3 alike).
pub const SUPPORTED_PLAN_SCHEMA_VERSIONS: [&str; 1] = ["0.3"];

/// The bridge protocol version the production face emits. v3 = frozen v2
/// superset (proposal 016); the receipt parser accepts v2 for the transition
/// window ([`ProductionJobReceipt::parse`]).
pub const PRODUCTION_FACE_SCHEMA_VERSION: u8 = 3;

/// Bridges the assembled v3 job into the core-owned envelope (`UnityCommand`
/// with the 93f841c/36b14ff extensions) — a field copy of the same frozen
/// shape. Cross-verified against [`build_job_command_json`] by test: the
/// serialized envelope and the assembled document agree on every field.
pub fn build_job_command(
    command_id: &str,
    project_id: &str,
    dry_run: bool,
    expected_project_fingerprint: Option<&str>,
    plan: &PlanFile,
    plan_schema_version: &str,
) -> Result<UnityCommand, PlanFileError> {
    // Reuse the shape-pinned assembly as the validator, then project.
    build_job_command_json(
        command_id,
        project_id,
        dry_run,
        expected_project_fingerprint,
        plan,
        plan_schema_version,
    )?;
    Ok(UnityCommand {
        schema_version: PRODUCTION_FACE_SCHEMA_VERSION,
        command_id: command_id.to_string(),
        operation: UnityOperation::ExecuteProductionJob,
        project_id: project_id.to_string(),
        dry_run,
        expected_project_fingerprint: expected_project_fingerprint.map(str::to_string),
        payload: UnityPayload {
            plan_hash: Some(plan.plan_hash.clone()),
            plan_schema_version: Some(plan_schema_version.to_string()),
            plan_ref: Some(plan.relative_ref.clone()),
            ..UnityPayload::default()
        },
    })
}

/// Bridges the assembled v3 restore into the core-owned envelope.
pub fn build_restore_command(
    command_id: &str,
    project_id: &str,
    dry_run: bool,
    expected_project_fingerprint: Option<&str>,
    snapshot_id: &str,
) -> Result<UnityCommand, PlanFileError> {
    build_restore_command_json(
        command_id,
        project_id,
        dry_run,
        expected_project_fingerprint,
        snapshot_id,
    )?;
    Ok(UnityCommand {
        schema_version: PRODUCTION_FACE_SCHEMA_VERSION,
        command_id: command_id.to_string(),
        operation: UnityOperation::RestoreProject,
        project_id: project_id.to_string(),
        dry_run,
        expected_project_fingerprint: expected_project_fingerprint.map(str::to_string),
        payload: UnityPayload {
            snapshot_id: Some(snapshot_id.to_string()),
            ..UnityPayload::default()
        },
    })
}

/// Assembles the v3 `execute_production_job` command document (frozen
/// schema: schemas/unity-bridge/v3/command.schema.json — the v2 same-face
/// superset; the production fields are byte-identical, only `schemaVersion`
/// moved 2→3). Deliberately self-contained JSON assembly — the core-owned
/// `UnityCommand` envelope gains the production operations in its own change
/// (93f841c); this document feeds the envelope by field copy
/// (schema_version=3, operation, payload fields) without reshaping.
pub fn build_job_command_json(
    command_id: &str,
    project_id: &str,
    dry_run: bool,
    expected_project_fingerprint: Option<&str>,
    plan: &PlanFile,
    plan_schema_version: &str,
) -> Result<serde_json::Value, PlanFileError> {
    if command_id.is_empty() || project_id.is_empty() {
        return Err(PlanFileError("command_id/project_id 必填".to_string()));
    }
    if !SUPPORTED_PLAN_SCHEMA_VERSIONS.contains(&plan_schema_version) {
        return Err(PlanFileError(format!(
            "计划 schemaVersion {plan_schema_version} 不在支持集合内"
        )));
    }
    let mut command = serde_json::json!({
        "schemaVersion": PRODUCTION_FACE_SCHEMA_VERSION,
        "commandId": command_id,
        "operation": "execute_production_job",
        "projectId": project_id,
        "dryRun": dry_run,
        "payload": {
            "planHash": plan.plan_hash,
            "planSchemaVersion": plan_schema_version,
            "planRef": plan.relative_ref
        }
    });
    if !dry_run {
        let fingerprint = expected_project_fingerprint.ok_or_else(|| {
            PlanFileError("实跑必须提供 expectedProjectFingerprint（乐观锁）".to_string())
        })?;
        command["expectedProjectFingerprint"] = serde_json::Value::String(fingerprint.to_string());
    }
    Ok(command)
}

/// Assembles the v3 `restore_project` command document (frozen schema:
/// schemas/unity-bridge/v3/command.schema.json; v2 same-face superset).
pub fn build_restore_command_json(
    command_id: &str,
    project_id: &str,
    dry_run: bool,
    expected_project_fingerprint: Option<&str>,
    snapshot_id: &str,
) -> Result<serde_json::Value, PlanFileError> {
    if command_id.is_empty() || project_id.is_empty() || snapshot_id.is_empty() {
        return Err(PlanFileError(
            "command_id/project_id/snapshot_id 必填".to_string(),
        ));
    }
    let mut command = serde_json::json!({
        "schemaVersion": PRODUCTION_FACE_SCHEMA_VERSION,
        "commandId": command_id,
        "operation": "restore_project",
        "projectId": project_id,
        "dryRun": dry_run,
        "payload": { "snapshotId": snapshot_id }
    });
    if !dry_run {
        let fingerprint = expected_project_fingerprint.ok_or_else(|| {
            PlanFileError("实跑必须提供 expectedProjectFingerprint（乐观锁）".to_string())
        })?;
        command["expectedProjectFingerprint"] = serde_json::Value::String(fingerprint.to_string());
    }
    Ok(command)
}

#[derive(Debug)]
pub struct PlanFileError(pub String);

impl std::fmt::Display for PlanFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PlanFileError {}

/// The file anchor returned by [`write_plan_file`]: the job-directory
/// relative reference to put into `payload.planRef` and the SHA-256 pin for
/// `payload.planHash`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanFile {
    pub relative_ref: String,
    pub plan_hash: String,
}

fn bridge_dir(project_root: &Path) -> PathBuf {
    project_root.join(".vua").join("bridge")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().map(|byte| format!("{:02x}", byte)).collect();
    format!("sha256:{hex}")
}

/// Writes the plan document into the bridge job directory and returns the
/// file anchor (relative ref + hash). `plan_json` must be the serialized
/// approved-plan document (recipe v0.3) whose schema version is in
/// [`SUPPORTED_PLAN_SCHEMA_VERSIONS`].
pub fn write_plan_file(
    project_root: &Path,
    command_id: &str,
    plan_json: &str,
) -> Result<PlanFile, PlanFileError> {
    if command_id.is_empty() {
        return Err(PlanFileError("command_id is required".to_string()));
    }
    let plan: serde_json::Value = serde_json::from_str(plan_json)
        .map_err(|error| PlanFileError(format!("计划文档不是合法 JSON：{error}")))?;
    let schema_version = plan
        .get("schemaVersion")
        .and_then(|value| value.as_str())
        .ok_or_else(|| PlanFileError("计划文档缺少 schemaVersion".to_string()))?;
    if !SUPPORTED_PLAN_SCHEMA_VERSIONS.contains(&schema_version) {
        return Err(PlanFileError(format!(
            "计划 schemaVersion {schema_version} 不在支持集合内"
        )));
    }

    let dir = bridge_dir(project_root);
    fs::create_dir_all(&dir)
        .map_err(|error| PlanFileError(format!("job 目录创建失败：{error}")))?;
    let file_name = format!("plan-{command_id}.json");
    let path = dir.join(&file_name);
    // Atomic-ish write: temp file in the same directory, then rename, so a
    // crashed write never leaves a half-written plan for the Bridge to hash.
    let temp = dir.join(format!("{file_name}.tmp"));
    fs::write(&temp, plan_json)
        .map_err(|error| PlanFileError(format!("临时文件写入失败：{error}")))?;
    fs::rename(&temp, &path)
        .map_err(|error| PlanFileError(format!("计划文件落位失败：{error}")))?;

    Ok(PlanFile {
        relative_ref: format!(".vua/bridge/{file_name}"),
        plan_hash: sha256_hex(plan_json.as_bytes()),
    })
}

/// Reads back and re-verifies a plan file (the provider-side mirror of the
/// Bridge's local hash check — the same file, the same anchor, verified
/// before it is ever referenced by a command).
pub fn read_plan_file(project_root: &Path, plan: &PlanFile) -> Result<String, PlanFileError> {
    let path = bridge_dir(project_root).join(
        PathBuf::from(plan.relative_ref.clone())
            .file_name()
            .ok_or_else(|| PlanFileError("planRef 缺少文件名".to_string()))?,
    );
    let bytes =
        fs::read(&path).map_err(|error| PlanFileError(format!("计划文件读取失败：{error}")))?;
    let actual = sha256_hex(&bytes);
    if actual != plan.plan_hash {
        return Err(PlanFileError(format!(
            "计划文件哈希漂移（期望 {expected}，实际 {actual}）",
            expected = plan.plan_hash
        )));
    }
    String::from_utf8(bytes).map_err(|error| PlanFileError(format!("计划文件不是 UTF-8：{error}")))
}

/// Typed projection of the `execute_production_job` receipt (the Bridge's
/// result document). Only the fields the provider consumes are mapped; the
/// receipt schema (schemas/unity-bridge/v3/result.schema.json, the v2
/// same-face superset) stays the authority.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionJobReceipt {
    #[allow(dead_code)]
    pub schema_version: u8,
    #[allow(dead_code)]
    pub command_id: String,
    pub status: String,
    #[serde(default)]
    pub data: ProductionJobReceiptData,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductionJobReceiptData {
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub replayed: bool,
    #[serde(default)]
    pub plan_hash: String,
    #[serde(default)]
    pub steps: Vec<ProductionJobStep>,
    #[serde(default)]
    pub snapshot_id: Option<String>,
    #[serde(default)]
    pub project_fingerprint_before: Option<String>,
    #[serde(default)]
    pub project_fingerprint: Option<String>,
    /// Legalized in v3 (proposal 016): the receipt of an
    /// `install_modular_asset` job carries the instance-root GlobalObjectId
    /// (proposal 011 success criterion). Absent (not merely empty) in v2
    /// receipts; empty when the plan ran no successful install.
    #[serde(default)]
    pub instance_global_object_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionJobStep {
    pub kind: String,
    pub status: String,
    #[serde(default)]
    pub warning: String,
    #[serde(default)]
    pub resolved_source: Option<ProductionResolvedSource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionResolvedSource {
    pub source_kind: String,
    pub artifact_sha256: String,
    #[serde(default)]
    pub warehouse_item_id: Option<String>,
}

impl ProductionJobReceipt {
    /// Parses a raw production-face result document (as produced by the
    /// Bridge). v3 is the migrated production face; v2 receipts stay valid
    /// for the transition window (the v2 face is frozen with all its
    /// vectors — a v2-labeled receipt only occurs for a v2 command from a
    /// pre-migration provider). Anything else is a typed refusal.
    pub fn parse(result_json: &str) -> Result<ProductionJobReceipt, PlanFileError> {
        let receipt: ProductionJobReceipt = serde_json::from_str(result_json)
            .map_err(|error| PlanFileError(format!("作业收据解析失败：{error}")))?;
        if receipt.schema_version != 2 && receipt.schema_version != 3 {
            return Err(PlanFileError(format!(
                "作业收据 schemaVersion {} 不在 v2/v3 接受集合内",
                receipt.schema_version
            )));
        }
        Ok(receipt)
    }

    /// True when the receipt represents an executed run (succeeded or failed)
    /// — those carry the pre-job snapshot identity; a rejected receipt never
    /// does (proposal 009 review point 4).
    pub fn executed(&self) -> bool {
        self.status == "succeeded" || self.status == "failed"
    }

    /// The plan hash echoed back by the Bridge; the caller pins it against
    /// the submitted hash so a receipt can never be attached to a different
    /// plan.
    pub fn verified_plan_hash(&self, expected: &str) -> Result<(), PlanFileError> {
        if self.data.plan_hash != expected {
            return Err(PlanFileError(format!(
                "收据 planHash {} 与提交 {} 不一致",
                self.data.plan_hash, expected
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("vua-prodjob-{label}-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    const PLAN: &str = r#"{"schemaVersion":"0.3","planId":"018f0000-0000-7000-8000-000000000001","jobs":[{"jobId":"018f0000-0000-7000-8000-000000000002","kind":"install_modular_asset","inputs":{},"resolvedSource":{"sourceKind":"original","artifactSha256":"sha256:aa","warehouseItemId":"wi-1"}}]}"#;

    #[test]
    fn w21_plan_file_is_written_into_the_bridge_directory_with_hash_anchor() {
        let root = unique_root("write");
        let plan = write_plan_file(&root, "job-run-01", PLAN).unwrap();
        assert_eq!(
            plan.relative_ref, ".vua/bridge/plan-job-run-01.json",
            "planRef points at the job-directory file"
        );
        assert!(
            plan.plan_hash.starts_with("sha256:") && plan.plan_hash.len() == 71,
            "hash anchor is a pinned sha256"
        );
        let written = fs::read_to_string(
            root.join(".vua")
                .join("bridge")
                .join("plan-job-run-01.json"),
        )
        .unwrap();
        assert_eq!(written, PLAN, "plan content is byte-identical");
    }

    #[test]
    fn w21_plan_hash_is_deterministic_and_the_readback_verifies_it() {
        let root = unique_root("determinism");
        let plan = write_plan_file(&root, "job-1", PLAN).unwrap();
        let again = write_plan_file(&root, "job-1", PLAN).unwrap();
        assert_eq!(plan.plan_hash, again.plan_hash, "same bytes, same anchor");
        let read_back = read_plan_file(&root, &plan).unwrap();
        assert_eq!(read_back, PLAN);
        let tampered = PlanFile {
            plan_hash: "sha256:00".to_string(),
            ..plan
        };
        assert!(
            read_plan_file(&root, &tampered).is_err(),
            "a drifting plan file must fail the read-back verification"
        );
    }

    #[test]
    fn w21_unsupported_plan_schema_version_is_rejected_before_writing() {
        let root = unique_root("unsupported");
        let plan = "{\"schemaVersion\":\"0.9\",\"jobs\":[]}";
        assert!(write_plan_file(&root, "job-2", plan).is_err());
        assert!(
            !root.join(".vua").exists(),
            "nothing is written for an unsupported plan version"
        );
    }

    #[test]
    fn w21_receipt_projection_parses_the_v2_shapes() {
        // Kept green through the v3 migration: the v2 face is frozen with
        // all its vectors valid, and [`ProductionJobReceipt::parse`] keeps
        // accepting v2 documents for the transition window.
        let real_run = r#"{
            "schemaVersion": 2, "commandId": "job-run-01", "operation": "execute_production_job",
            "status": "succeeded", "changedPaths": ["Assets/a.prefab"], "diagnostics": [],
            "data": {
                "dryRun": false, "replayed": false,
                "planHash": "sha256:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
                "steps": [
                    {"kind": "install_modular_asset", "status": "executed",
                     "resolvedSource": {"sourceKind": "original", "artifactSha256": "sha256:aa",
                                        "warehouseItemId": "wi-1"}}
                ],
                "snapshotId": "snap-0001",
                "projectFingerprintBefore": "fp-before",
                "projectFingerprint": "fp-after"
            }
        }"#;
        let receipt = ProductionJobReceipt::parse(real_run).unwrap();
        assert!(receipt.executed());
        receipt
            .verified_plan_hash(
                "sha256:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809",
            )
            .unwrap();
        assert_eq!(receipt.data.snapshot_id.as_deref(), Some("snap-0001"));
        assert_eq!(receipt.data.steps.len(), 1);
        assert_eq!(
            receipt.data.steps[0]
                .resolved_source
                .as_ref()
                .unwrap()
                .source_kind,
            "original"
        );

        let rejected = r#"{
            "schemaVersion": 2, "commandId": "job-run-02", "operation": "execute_production_job",
            "status": "rejected", "changedPaths": [], "diagnostics": []
        }"#;
        let receipt = ProductionJobReceipt::parse(rejected).unwrap();
        assert!(
            !receipt.executed(),
            "a rejected receipt never claims execution"
        );
    }

    #[test]
    fn w21_receipt_plan_hash_mismatch_is_typed() {
        let receipt_json = r#"{
            "schemaVersion": 2, "commandId": "x", "operation": "execute_production_job",
            "status": "succeeded", "changedPaths": [], "diagnostics": [],
            "data": {"dryRun": false, "planHash": "sha256:bb", "steps": []}
        }"#;
        let receipt = ProductionJobReceipt::parse(receipt_json).unwrap();
        assert!(receipt.verified_plan_hash("sha256:aa").is_err());
    }

    #[test]
    fn production_receipt_parse_consumes_the_frozen_v3_vector() {
        // The migrated production face consumes the frozen machine face
        // directly: the v3 example vector (schemas/unity-bridge/
        // v3/examples/production-job-run-instance.result.json) parses into
        // the typed projection, including the legalized proposal-011
        // instance identity.
        let vector = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../schemas/unity-bridge/v3/examples/production-job-run-instance.result.json"
        ))
        .expect("frozen v3 receipt vector must exist");
        let receipt = ProductionJobReceipt::parse(&vector).unwrap();
        assert_eq!(receipt.schema_version, 3);
        assert!(receipt.executed());
        receipt
            .verified_plan_hash(
                "sha256:9a8b7c6d5e4f302918a7b6c5d4e3f2091a8b7c6d5e4f302918a7b6c5d4e3f209",
            )
            .unwrap();
        assert_eq!(receipt.data.steps.len(), 1);
        assert_eq!(
            receipt.data.instance_global_object_id.as_deref(),
            Some("GlobalObjectId_V1-2-00000000000000000000000000000000-200000-0"),
            "the legalized proposal-011 instance identity must survive the projection"
        );
    }

    #[test]
    fn production_receipt_parse_rejects_versions_outside_the_v2_v3_set() {
        for version in [1u8, 4] {
            let receipt_json = format!(
                r#"{{
                    "schemaVersion": {version}, "commandId": "x",
                    "operation": "execute_production_job",
                    "status": "succeeded", "changedPaths": [], "diagnostics": [],
                    "data": {{"dryRun": false, "planHash": "sha256:bb", "steps": []}}
                }}"#
            );
            let error = ProductionJobReceipt::parse(&receipt_json)
                .expect_err("a receipt outside the v2/v3 acceptance set must be a typed refusal");
            assert!(
                error.0.contains("不在 v2/v3 接受集合内"),
                "the refusal must name the acceptance set: {}",
                error.0
            );
        }
    }

    #[test]
    fn w21_job_command_json_matches_the_frozen_v3_envelope() {
        // Production face migrated to v3 (2026-09-13 slice): the assembled
        // document carries schemaVersion 3 under the frozen v3 schema (the
        // v2 same-face superset) — every production field is unchanged.
        let root = unique_root("cmd");
        let plan = write_plan_file(&root, "job-run-01", PLAN).unwrap();
        let command =
            build_job_command_json("job-run-01", "proj", false, Some("fp-before"), &plan, "0.3")
                .unwrap();
        assert_eq!(command["schemaVersion"], serde_json::json!(3));
        assert_eq!(
            command["operation"],
            serde_json::json!("execute_production_job")
        );
        assert_eq!(
            command["expectedProjectFingerprint"],
            serde_json::json!("fp-before")
        );
        assert_eq!(
            command["payload"]["planRef"],
            serde_json::json!(plan.relative_ref)
        );
        assert_eq!(
            command["payload"]["planHash"],
            serde_json::json!(plan.plan_hash)
        );

        // Real runs demand the fingerprint lock; dry-runs must not carry one.
        let dry = build_job_command_json("d", "proj", true, None, &plan, "0.3").unwrap();
        assert!(dry.get("expectedProjectFingerprint").is_none());
        assert!(
            build_job_command_json("r", "proj", false, None, &plan, "0.3").is_err(),
            "a real run without the fingerprint lock must be a typed error"
        );
        assert!(
            build_job_command_json("r", "proj", false, Some("fp"), &plan, "0.9").is_err(),
            "unsupported plan schema versions are rejected at assembly"
        );
    }

    #[test]
    fn production_face_v3_documents_validate_against_the_frozen_v3_schema() {
        // The migrated emitter is consumed against the frozen machine face:
        // both production documents must validate under
        // schemas/unity-bridge/v3/command.schema.json exactly as emitted.
        let validator = jsonschema::validator_for(
            &serde_json::from_slice(
                &std::fs::read(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/../../schemas/unity-bridge/v3/command.schema.json"
                ))
                .expect("frozen v3 command schema must exist"),
            )
            .expect("frozen v3 command schema must be valid JSON"),
        )
        .expect("frozen v3 command schema must compile");

        let root = unique_root("v3schema");
        let plan = write_plan_file(&root, "job-run-v3", PLAN).unwrap();
        let job =
            build_job_command_json("job-run-v3", "proj", false, Some("fp-before"), &plan, "0.3")
                .unwrap();
        assert!(
            validator.is_valid(&job),
            "assembled v3 execute_production_job must validate against the frozen v3 schema: {job}"
        );
        let restore =
            build_restore_command_json("restore-v3", "proj", false, Some("fp-current"), "snap-1")
                .unwrap();
        assert!(
            validator.is_valid(&restore),
            "assembled v3 restore_project must validate against the frozen v3 schema: {restore}"
        );
    }

    #[test]
    fn w21_restore_command_json_carries_the_snapshot_identity() {
        let command = build_restore_command_json(
            "restore-01",
            "proj",
            false,
            Some("fp-current"),
            "snap-0001",
        )
        .unwrap();
        assert_eq!(command["schemaVersion"], serde_json::json!(3));
        assert_eq!(command["operation"], serde_json::json!("restore_project"));
        assert_eq!(
            command["payload"]["snapshotId"],
            serde_json::json!("snap-0001")
        );
        assert_eq!(
            command["expectedProjectFingerprint"],
            serde_json::json!("fp-current")
        );
        assert!(
            build_restore_command_json("r", "proj", false, Some("fp"), "").is_err(),
            "a restore without a snapshot identity must be a typed error"
        );
    }

    #[test]
    fn w21_core_envelope_bridge_agrees_with_the_assembled_document() {
        // The core-owned envelope bridge (field copy) and the shape-pinned
        // JSON assembly must agree on every production field (v3 face after
        // the migration). Known cross-domain
        // shape note (reported to core): the core UnityPayload serializes
        // its v1 String fields as empty strings (no skip), while the frozen
        // v2 schema gives them minLength 1 — harmless for the C# consumer
        // (DTO fields default to empty) but a wire-schema strictness gap
        // only the core can close.
        let root = unique_root("bridge");
        let plan = write_plan_file(&root, "job-run-01", PLAN).unwrap();
        let envelope =
            build_job_command("job-run-01", "proj", false, Some("fp-before"), &plan, "0.3")
                .unwrap();
        let document =
            build_job_command_json("job-run-01", "proj", false, Some("fp-before"), &plan, "0.3")
                .unwrap();
        assert_eq!(envelope.schema_version, PRODUCTION_FACE_SCHEMA_VERSION);
        assert_eq!(envelope.command_id, "job-run-01");
        assert_eq!(envelope.operation, UnityOperation::ExecuteProductionJob);
        assert_eq!(envelope.project_id, "proj");
        assert!(!envelope.dry_run);
        assert_eq!(
            envelope.expected_project_fingerprint.as_deref(),
            Some("fp-before")
        );
        assert_eq!(
            envelope.payload.plan_hash.as_deref(),
            document["payload"]["planHash"].as_str()
        );
        assert_eq!(
            envelope.payload.plan_schema_version.as_deref(),
            document["payload"]["planSchemaVersion"].as_str()
        );
        assert_eq!(
            envelope.payload.plan_ref.as_deref(),
            document["payload"]["planRef"].as_str()
        );

        let restore =
            build_restore_command("restore-01", "proj", false, Some("fp-current"), "snap-0001")
                .unwrap();
        let restore_document = build_restore_command_json(
            "restore-01",
            "proj",
            false,
            Some("fp-current"),
            "snap-0001",
        )
        .unwrap();
        assert_eq!(restore.operation, UnityOperation::RestoreProject);
        assert_eq!(
            restore.payload.snapshot_id.as_deref(),
            restore_document["payload"]["snapshotId"].as_str()
        );
        assert_eq!(
            restore.expected_project_fingerprint.as_deref(),
            Some("fp-current")
        );
    }

    #[test]
    fn w21_original_source_stages_the_guid_layout_with_manifest_digest() {
        use flate2::write::GzEncoder;
        use std::fs::File;
        use tar::{Builder, Header};

        let root = unique_root("stage");
        let archive_path = root.join("pack.unitypackage");
        // Build a minimal guid-layout package: <guid>/pathname + <guid>/asset.
        let file = File::create(&archive_path).unwrap();
        let mut builder = Builder::new(GzEncoder::new(file, flate2::Compression::default()));
        let append = |builder: &mut Builder<GzEncoder<fs::File>>, path: &str, bytes: &[u8]| {
            let mut header = Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, bytes).unwrap();
        };
        append(
            &mut builder,
            "a1b2c3d4eeee4aaa8bbbccccddddeeee/pathname",
            b"Assets/Outfit/root.prefab\n",
        );
        append(
            &mut builder,
            "a1b2c3d4eeee4aaa8bbbccccddddeeee/asset",
            b"synthetic asset bytes",
        );
        let gz_encoder = builder.into_inner().unwrap();
        gz_encoder.finish().unwrap();

        let archive_digest = crate::material_exec::sha256_file(&archive_path).unwrap();
        let staged =
            stage_original_source(&archive_path, &root, "job-01", &archive_digest).unwrap();
        assert!(
            staged
                .source_package_path
                .replace('\\', "/")
                .contains(".vua/imports/prodjob-job-01"),
            "staged layout lives under .vua/imports/prodjob-<command_id>"
        );
        assert!(
            staged.manifest_sha256.starts_with("sha256:"),
            "manifest digest is bound for the C# materialize base"
        );
        let extracted = PathBuf::from(&staged.source_package_path);
        assert!(extracted.join("manifest.sha256").exists());
        assert!(extracted.join("a1b2c3d4eeee4aaa8bbbccccddddeeee").exists());

        // Source drift: a different digest must refuse to stage.
        assert!(
            stage_original_source(&archive_path, &root, "job-02", "sha256:00").is_err(),
            "a drifted source must be a typed refusal"
        );
    }
}
