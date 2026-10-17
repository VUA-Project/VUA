use crate::{
    AvatarSetupRequest, PlanStep, ResultStatus, SnapshotRef, SnapshotStore, UnityCommand,
    UnityOperation, UnityPayload, UnityResult, WorkflowPlan, WorkflowReport, WorkflowStage,
};
use std::fmt::{Display, Formatter};

const OPERATIONS: [UnityOperation; 6] = [
    UnityOperation::InspectProject,
    UnityOperation::IdentifyAssets,
    UnityOperation::InstallOutfit,
    UnityOperation::CreateToggle,
    UnityOperation::ValidateAvatar,
    UnityOperation::AnalyzePerformance,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowError {
    InvalidStage {
        expected: WorkflowStage,
        actual: WorkflowStage,
    },
    MismatchedCommand {
        expected: String,
        actual: String,
    },
    CommandFailed(String),
    Snapshot(String),
}

impl Display for WorkflowError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for WorkflowError {}

pub struct AvatarSetupWorkflow {
    request: AvatarSetupRequest,
    stage: WorkflowStage,
    next_operation: usize,
    pending_command_id: Option<String>,
    snapshot: Option<SnapshotRef>,
    results: Vec<UnityResult>,
}

impl AvatarSetupWorkflow {
    pub fn new(request: AvatarSetupRequest) -> Self {
        Self {
            request,
            stage: WorkflowStage::Plan,
            next_operation: 0,
            pending_command_id: None,
            snapshot: None,
            results: Vec::new(),
        }
    }

    pub fn stage(&self) -> WorkflowStage {
        self.stage
    }

    pub fn plan(&mut self) -> WorkflowPlan {
        self.stage = WorkflowStage::AwaitConfirmation;
        WorkflowPlan {
            workflow_id: self.request.workflow_id.clone(),
            project: self.request.project.clone(),
            steps: OPERATIONS
                .iter()
                .copied()
                .map(|operation| PlanStep {
                    operation,
                    label: label(operation).to_owned(),
                    mutates_project: operation.is_mutating(),
                })
                .collect(),
        }
    }

    pub fn confirm<S: SnapshotStore>(&mut self, snapshots: &S) -> Result<(), WorkflowError>
    where
        S::Error: Display,
    {
        self.require_stage(WorkflowStage::AwaitConfirmation)?;
        self.stage = WorkflowStage::Snapshot;
        let snapshot_id = format!("{}-before", self.request.workflow_id);
        match snapshots.create(&self.request.project, &snapshot_id) {
            Ok(snapshot) => {
                self.snapshot = Some(snapshot);
                self.stage = WorkflowStage::Execute;
                Ok(())
            }
            Err(error) => {
                self.stage = WorkflowStage::Recover;
                Err(WorkflowError::Snapshot(error.to_string()))
            }
        }
    }

    pub fn next_command(
        &mut self,
        fingerprint: Option<String>,
    ) -> Result<Option<UnityCommand>, WorkflowError> {
        if self.stage == WorkflowStage::Completed {
            return Ok(None);
        }
        if !matches!(self.stage, WorkflowStage::Execute | WorkflowStage::Validate) {
            return Err(WorkflowError::InvalidStage {
                expected: WorkflowStage::Execute,
                actual: self.stage,
            });
        }
        if self.pending_command_id.is_some() {
            return Err(WorkflowError::CommandFailed(
                "a command is already pending".into(),
            ));
        }

        let Some(operation) = OPERATIONS.get(self.next_operation).copied() else {
            self.stage = WorkflowStage::Completed;
            return Ok(None);
        };
        let command_id = format!(
            "{}-{:02}",
            self.request.workflow_id,
            self.next_operation + 1
        );
        self.pending_command_id = Some(command_id.clone());
        self.stage = if matches!(
            operation,
            UnityOperation::ValidateAvatar | UnityOperation::AnalyzePerformance
        ) {
            WorkflowStage::Validate
        } else {
            WorkflowStage::Execute
        };

        Ok(Some(UnityCommand {
            schema_version: 1,
            command_id,
            operation,
            project_id: self.request.project.id.clone(),
            dry_run: !operation.is_mutating(),
            expected_project_fingerprint: fingerprint,
            payload: UnityPayload {
                avatar_global_object_id: self.request.avatar_global_object_id.clone(),
                avatar_armature_global_object_id: self
                    .request
                    .avatar_armature_global_object_id
                    .clone(),
                outfit_global_object_id: self.request.outfit_global_object_id.clone(),
                outfit_armature_global_object_id: self
                    .request
                    .outfit_armature_global_object_id
                    .clone(),
                toggle_name: self.request.toggle_name.clone(),
                ..UnityPayload::default()
            },
        }))
    }

    pub fn accept_result(&mut self, result: UnityResult) -> Result<(), WorkflowError> {
        let expected = self.pending_command_id.take().ok_or_else(|| {
            WorkflowError::CommandFailed("received a result with no pending command".into())
        })?;
        if result.command_id != expected {
            self.pending_command_id = Some(expected.clone());
            return Err(WorkflowError::MismatchedCommand {
                expected,
                actual: result.command_id,
            });
        }
        if result.status != ResultStatus::Succeeded {
            self.stage = WorkflowStage::Recover;
            let message = result
                .diagnostics
                .first()
                .map(|item| item.message.clone())
                .unwrap_or_else(|| "Unity rejected the operation".into());
            self.results.push(result);
            return Err(WorkflowError::CommandFailed(message));
        }

        self.results.push(result);
        self.next_operation += 1;
        self.stage = if self.next_operation == OPERATIONS.len() {
            WorkflowStage::Completed
        } else {
            WorkflowStage::Execute
        };
        Ok(())
    }

    pub fn recover<S: SnapshotStore>(&mut self, snapshots: &S) -> Result<(), WorkflowError>
    where
        S::Error: Display,
    {
        self.require_stage(WorkflowStage::Recover)?;
        let snapshot = self
            .snapshot
            .as_ref()
            .ok_or_else(|| WorkflowError::Snapshot("no verified snapshot is available".into()))?;
        snapshots
            .restore(&self.request.project, snapshot)
            .map_err(|error| WorkflowError::Snapshot(error.to_string()))?;
        Ok(())
    }

    pub fn report(&self) -> WorkflowReport {
        let diagnostics = self
            .results
            .iter()
            .flat_map(|result| result.diagnostics.clone())
            .collect();
        let performance = self
            .results
            .iter()
            .rev()
            .find(|result| result.command_id.ends_with("-06"))
            .map(|result| result.data.clone())
            .unwrap_or(serde_json::Value::Null);
        WorkflowReport {
            workflow_id: self.request.workflow_id.clone(),
            stage: self.stage,
            completed_operations: OPERATIONS[..self.next_operation].to_vec(),
            diagnostics,
            performance,
        }
    }

    fn require_stage(&self, expected: WorkflowStage) -> Result<(), WorkflowError> {
        if self.stage == expected {
            Ok(())
        } else {
            Err(WorkflowError::InvalidStage {
                expected,
                actual: self.stage,
            })
        }
    }
}

fn label(operation: UnityOperation) -> &'static str {
    match operation {
        UnityOperation::InspectProject => "检查 Unity 项目",
        UnityOperation::ImportUnityPackage => "导入 Unity Package",
        UnityOperation::MaterializeExtractedPackage => "物化已解包 Unity Package",
        UnityOperation::CreateLocalVpmPackage => "创建本地 VPM 包",
        UnityOperation::ValidateAssetPaths => "验证素材路径",
        UnityOperation::IdentifyAssets => "确认 Avatar 与衣装",
        UnityOperation::InstallOutfit => "用 Modular Avatar 安装衣装",
        UnityOperation::CreateToggle => "创建衣装菜单开关",
        UnityOperation::ValidateAvatar => "验证组装结果",
        UnityOperation::AnalyzePerformance => "生成性能报告",
        UnityOperation::ExecuteProductionJob => "执行批准计划作业",
        UnityOperation::RestoreProject => "恢复项目到恢复点",
        UnityOperation::InspectAvatarReferences => "检查 Avatar 资产引用完整性",
        UnityOperation::InspectLighting => "检查场景光照事实",
        UnityOperation::InspectUploadReadiness => "检查上传准备度前置项",
        UnityOperation::BuildPreview => "烘焙 Release 预览转盘",
        UnityOperation::AmfPrepare => "Prepare AMF work scene",
        UnityOperation::AmfInspect => "Inspect AMF material candidates",
        UnityOperation::AmfAssemble => "Assemble AMF Avatar",
        UnityOperation::AmfTurntable => "Bake the AMF Avatar turntable",
    }
}
