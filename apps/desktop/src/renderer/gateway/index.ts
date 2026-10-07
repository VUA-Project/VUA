/**
 * Gateway 公共入口(barrel):表现层只允许从这里取端口类型与装配函数,
 * 禁止散引 src/gateway/ 内部文件(check:boundary 验收)。
 *
 * fixture-gateway 故意不在此导出:它只能经 create.ts 的 DEV 硬防线可达,
 * 生产构建被 Rollup 剔除(check:leak 验证)。
 */

export type {
  CapabilityDetailKey,
  CapabilityReport,
  CapabilityState,
  DataSource,
  Unsubscribe,
} from "./types.ts";
export { capabilityDetailKeys, capabilityStates } from "./types.ts";
export {
  catalogProductRef,
  entityRef,
  parseCatalogVariantId,
  type AssetRecord,
  type AssetSourceVerification,
  type CatalogAvailability,
  type CatalogPrice,
  type CatalogProductRef,
  type CatalogVariantId,
  type EntityRef,
  type RecipeSourceRef,
} from "./refs.ts";
export type {
  AvatarAdaptationHint,
  CompatClaim,
  CompatConfidence,
  CompatSourceKind,
  CompatStatus,
} from "./compat.ts";
export type { CatalogHealth, CatalogRevision, CatalogStatus } from "./catalog.ts";
export type {
  CatalogAvailabilityStatus,
  CatalogBrowserPort,
  CatalogBrowserQuery,
  CatalogDetailView,
  CatalogEntityBrief,
  CatalogErrorKey,
  CatalogListView,
  CatalogProductDetail,
  CatalogProductSummary,
  CatalogRelationBrief,
  CatalogRelationKind,
  CatalogSubproduct,
} from "./catalog-browser-port.ts";
export { createCatalogBrowser } from "./catalog-browser-instance.ts";
export {
  taskStatusForWorkflow,
  workflowRunStates,
  type WorkflowRunState,
  type WorkflowStage,
} from "./workflow.ts";
export type { EnvironmentPort, EnvironmentView, NetworkPort } from "./environment-port.ts";
export { CURRENT_RECIPE_ID } from "./model-production-port.ts";
export {
  buildRecordDisplayStatuses,
  projectBuildRecordDisplayStatus,
  inspectionFindingKinds,
  planDiffKinds,
  planRiskChoices,
  plannabilityStates,
  productionRejectReasons,
  recoverDecisionKinds,
  sourceIntakes,
} from "./model-production-port.ts";
export type {
  BuildRecord,
  BuildRecordEvidenceSummary,
  BuildRecordAuthorityStatus,
  BuildRecordDisplayStatus,
  BuildRecordView,
  InspectionFinding,
  InspectionFindingKind,
  InspectionReport,
  InspectionView,
  MaterialRef,
  ModelProductionCapabilities,
  ModelProductionPort,
  ModelProductionView,
  PlanDiff,
  PlanDiffKind,
  PlanRisk,
  PlanRiskChoice,
  PlanView,
  Plannability,
  ProductionIntentResult,
  ProductionPlan,
  ProductionRejectReason,
  ProductionRunView,
  RecipeConflict,
  RecipeGraphEdge,
  RecipeGraphNode,
  RecipeGraphView,
  RecipeNodeState,
  RecoverDecision,
  RecoverDecisionKind,
  ReleaseInspection,
  ReleaseProject,
  ReleaseProjectHealth,
  ReleaseWallView,
  ShareCodeExportResult,
  ShareCodeImportResult,
  ShareCodeRejectReason,
  SourceIntake,
} from "./model-production-port.ts";
export type { ToolCard, ToolCatalogPort, ToolCatalogView, ToolCategory } from "./tool-catalog-port.ts";
export type {
  AcquireEntryDetailView,
  AcquirePort,
  AcquireView,
  WarehouseArtifact,
  WarehouseArtifactFact,
  WarehouseArtifactMode,
  WarehouseArtifactRole,
  WarehouseArtifactState,
  WarehouseEntry,
  WarehouseEntryDetail,
  WarehouseEntryKind,
} from "./acquire-port.ts";
export type {
  WarehouseCommandOutcome,
  WarehouseCommandsPort,
  WarehouseMaintenanceAcceptance,
  WarehouseModeSetResult,
} from "./warehouse-commands-port.ts";
export {
  entryPreviewProductIds,
  readEntryPreview,
} from "./entry-preview.ts";
export type {
  EntryPreviewAlbum,
  EntryPreviewView,
} from "./entry-preview.ts";
export type {
  ProjectImportCopyParams,
  ProjectOpsOutcome,
  ProjectOpsPort,
  ProjectListProjectsOutcome,
  RegisteredProjectRow,
} from "./project-ops-port.ts";
export {
  createUnavailableRecipeExportPort,
  narrowRecipeProjectDraft,
} from "./recipe-export-port.ts";
export type {
  RecipeExportOutcome,
  RecipeExportPort,
  RecipeProjectDraft,
} from "./recipe-export-port.ts";
export {
  createLiveDependenciesPort,
  createUnavailableDependenciesPort,
  narrowDependencyMatch,
  narrowDependencyObservation,
} from "./dependencies-port.ts";
export type {
  DependenciesErrorKey,
  DependenciesLookupQuery,
  DependenciesLookupView,
  DependenciesObservationsView,
  DependenciesPort,
} from "./dependencies-port.ts";
export type {
  InspectionDetailView,
  InspectionListQuery,
  InspectionListView,
  InspectionPort,
} from "../features/inspection/inspection-port.ts";
export type {
  HandoffTaskView,
  ReleaseHandoffIntent,
  ReleaseHandoffPort,
} from "../features/release/release-handoff-port.ts";
export type {
  ChangeRequest,
  InstalledListAnswer,
  InstalledPackageRowV01,
  InstalledPackageRowV02,
  CatalogPackageFactsV01,
  CatalogPackageFactsV02,
  CatalogVersionRowV01,
  PackageChangeItem,
  PackageChangeKind,
  PackageChangePreview,
  PackageEntryResult,
  PackageProject,
  PackageRow,
  PackagesChangeItemV01,
  PackagesInstallApplyOutcome,
  PackagesInstallPlanV02,
  PackagesInstallReceiptV02,
  PackagesOpsRejectedV02,
  PackagesPackageRequestV02,
  PackagesP1LoadError,
  PackagesP2LoadError,
  PackagesPort,
  PackagesRegisterApplyOutcome,
  PackagesRegisterResultV03,
  PackagesLocalRepoAddedV04,
  PackagesRemoteRepoAddedV04,
  PackagesRepoAddApplyOutcome,
  PackagesRepoRejectedV04,
  PackagesRepoRemoveApplyOutcome,
  PackagesRepoRemovedV04,
  PackagesCreateApplyOutcome,
  PackagesCreateProjectResultV05,
  PackagesCreateRejectedV05,
  PackagesProjectCreatedV05,
  PackagesRemoveApplyOutcome,
  PackagesRemovePlanV01,
  PackagesRemoveReceiptV01,
  PackagesRemoveRejectedV01,
  PackagesTemplateItemV01,
  PackagesView,
  PackageSource,
  PackageVersionEntry,
  RepoCatalogFactsV01,
  RepoCatalogPackageRowV01,
  RepoCatalogRepoRowV01,
  RepoHealth,
  TemplatesFactsV01,
  RepoInfo,
  RepoInfoRowV01,
  RepoInfoRowV02,
} from "./packages-port.ts";
export type { SettingsPort, SettingsView } from "./settings-port.ts";
export { createSignal } from "./signal.ts";
export type { CancelTaskResult, TaskCenterView, TaskItem, TaskPort } from "./task-port.ts";
export { registerTaskIdentity, taskIdentityOf } from "./task-identity.ts";
export type { TaskIdentity } from "./task-identity.ts";
export { createInactiveTutorialPort } from "./tutorial-port.ts";
export type { DispatchResult, TutorialAction, TutorialPort, TutorialSnapshot } from "./tutorial-port.ts";
export type { VuaGateway } from "./gateway.ts";
export type { GatewayClient } from "./gateway-client.ts";
export { createGatewayClient } from "./gateway-client.ts";
export { emptyGateway } from "./empty-gateway.ts";
export { createGatewayState } from "./create.ts";
export type { GatewayStateName } from "./create.ts";
export type { FixtureTaskPort } from "./fixture-gateway.ts";
export {
  GatewayProvider,
  useAcquireView,
  useDataSource,
  useEnvironmentView,
  useGateway,
  usePackagesView,
  useProductionRunView,
  useSettingsView,
  useTaskCenter,
  useToolCatalogView,
  useWorkshopView,
} from "./GatewayProvider.tsx";
