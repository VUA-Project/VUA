import {
  type DemoTaskStartedV01,
  type EnvironmentSnapshotV01,
  type EnvironmentVerifyEditorResultV01,
  ENVIRONMENT_VERIFY_UNAVAILABLE,
  APPLICATION_CONTRACT_VERSION,
  isTerminalTaskStateV01,
  type AppErrorV01,
  type ApplicationContractVersion,
  type ApplicationEventV01,
  type ApplicationRequestV01,
  type ApplicationResponseV01,
  type BuildRecordDocumentV02,
  type CatalogListResultV03,
  type CatalogStatusResultV03,
  type DownloadsListCompletedResultV04,
  type WarehouseListEntriesResultV03,
  type CapabilityOperationV01,
  type InspectionDocumentV02,
  type PlanDocumentV02,
  type TaskCancellationResultV01,
  type TaskSnapshotV01,
  type TaskRecoveryDispositionV01,
  type TaskStateV01,
} from "@vua/contracts";
import type {
  BlockingTaskV01,
  ContinueShutdownRequestV01,
  OrchestratorProviderV01,
  ProviderEventListenerV01,
  ProviderHandshakeV01,
  ProviderShutdownResultV01,
  ProviderStatusV01,
  ProviderUnsubscribe,
} from "./provider.js";

export interface MockProviderOptionsV01 {
  readonly providerBuildId?: string;
  readonly providerInstanceId?: string;
  readonly now?: () => string;
  readonly capabilities?: readonly CapabilityOperationV01[];
  readonly tasks?: readonly TaskSnapshotV01[];
  readonly mutatingTaskIds?: readonly string[];
  readonly environment?: EnvironmentSnapshotV01;
  /**
   * U10 设置面 DEV 走查注入(021 词表行,桌面消费批):给定手选路径返回
   * 确定性两态 result(向量形状)。默认 undefined:mock 无验证原语可达,
   * 按裁决⑤诚实缺席语义回 vua.environment.verify_unavailable——缺席码仅
   * 表达「原语不可达」,绝不冒充验证拒绝(拒绝是 result 内态,钉子一)。
   * 注入面仅供 DEV fixture/测试,生产构建经 leak 扫描把守不出 DEV。
   */
  readonly environmentVerifyEditor?: (path: string) => EnvironmentVerifyEditorResultV01;
  /**
   * confirmPlan/recover 受理后立即完成(镜像真实 worker 驱动到终态的语义,
   * 供向量回放的 waitTerminal 使用)。默认 false:任务保持 queued,由调用方
   * 经 commitTaskState 脚本化驱动(mock 既有测试纪律)。
   */
  readonly productionAutoComplete?: boolean;
}

/**
 * production 命令成功值(amf-production v0.2,与 B 线 provider_host 同形):
 * 命令回执 = { contractVersion, task } + 域身份(startInspection 附
 * inspectionId;requestPlan 附 planId/revision);文档查询 = 任务事实 +
 * 内嵌文档。域身份登记表(inspectionId/planId → 文档 + 绑定 + 任务)镜像
 * B 侧 production_domain_records:路径四元组随 startInspection 绑定一次,
 * 后续命令不再携带路径。
 */
export interface ProductionTaskStartedV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly task: TaskSnapshotV01;
}

/** 域身份登记条目(模拟 B 侧 production_domain_records 行) */
interface MockDomainRecord {
  readonly kind: "inspection" | "plan";
  readonly taskId: string;
  readonly document: InspectionDocumentV02 | PlanDocumentV02;
  /** 一次性绑定:startInspection = 四元组 + createdAt;requestPlan = 引用 + revision */
  readonly binding: Record<string, unknown>;
}

const PRODUCTION_MODES_V02: readonly string[] = ["direct_unity_package", "local_reusable_vpm"];
const PRODUCTION_RISK_CHOICES_V02: readonly string[] = [
  "snapshot_and_continue",
  "continue",
  "cancel",
  "not_required",
];
const INSPECTION_ID_PATTERN = /^insp-[0-9a-f]{16}$/;
const PLAN_ID_PATTERN = /^plan-[0-9a-f]{16}$/;

export class MockOrchestratorProviderV01 implements OrchestratorProviderV01 {
  readonly contractVersion = APPLICATION_CONTRACT_VERSION;

  readonly #providerBuildId: string;
  readonly #providerInstanceId: string;
  readonly #now: () => string;
  readonly #tasks = new Map<string, TaskSnapshotV01>();
  readonly #mutatingTaskIds = new Set<string>();
  readonly #listeners = new Set<ProviderEventListenerV01>();
  readonly #commandResults = new Map<string, { taskId: string; result: TaskCancellationResultV01 }>();
  readonly #demoCommandResults = new Map<string, DemoTaskStartedV01>();
  #productionSequence = 0;
  #domainSequence = 0;
  /** commandId → 已创建任务与签发域身份(幂等重放依据) */
  #productionCommands = new Map<
    string,
    { taskId: string; inspectionId?: string; planId?: string; revision?: number }
  >();
  /** 域身份登记表(inspectionId/planId → 文档 + 一次性绑定 + 任务) */
  #domainRecords = new Map<string, MockDomainRecord>();
  /** 构建记录(recordId → 负载;planId 别名同键):真实写入属执行器 */
  #buildRecords = new Map<string, BuildRecordDocumentV02>();
  readonly #capabilities: readonly CapabilityOperationV01[];
  readonly #environment: EnvironmentSnapshotV01 | undefined;
  readonly #environmentVerifyEditor: ((path: string) => EnvironmentVerifyEditorResultV01) | undefined;
  readonly #productionAutoComplete: boolean;
  #demoTaskSequence = 0;
  #state: ProviderStatusV01["state"] = "stopped";
  #acceptingCalls = false;
  #applicationRevision = 1;
  #eventSequence = 0;

  constructor(options: MockProviderOptionsV01 = {}) {
    this.#providerBuildId = options.providerBuildId ?? "mock-provider-build";
    this.#providerInstanceId = options.providerInstanceId ?? "mock-provider-instance";
    this.#now = options.now ?? (() => "2026-09-02T00:00:00.000Z");
    this.#capabilities = [...(options.capabilities ?? [])].sort((left, right) =>
      left.operationId.localeCompare(right.operationId));
    for (const task of options.tasks ?? []) this.#tasks.set(task.taskId, task);
    for (const taskId of options.mutatingTaskIds ?? []) this.#mutatingTaskIds.add(taskId);
    this.#environment = options.environment;
    this.#environmentVerifyEditor = options.environmentVerifyEditor;
    this.#productionAutoComplete = options.productionAutoComplete ?? false;
  }

  status(): ProviderStatusV01 {
    return {
      contractVersion: this.contractVersion,
      state: this.#state,
      acceptingCalls: this.#acceptingCalls,
    };
  }

  async start(): Promise<ProviderHandshakeV01> {
    if (this.#state === "stopping") throw new Error("provider is stopping");
    this.#state = "starting";
    this.#acceptingCalls = true;
    this.#state = "ready";
    return {
      contractVersion: this.contractVersion,
      supportedContractVersions: [this.contractVersion],
      providerBuildId: this.#providerBuildId,
      providerInstanceId: this.#providerInstanceId,
      // proposal 001: the capability bit is mandatory on the v0.1 wire; the
      // mock has no download domain, so it reports honest absence.
      downloadIngest: false,
    };
  }

  async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
    if (!this.#acceptingCalls || this.#state !== "ready") {
      return this.#failure(request, this.#error(
        "vua.provider.not_accepting",
        "unavailable",
        "errors.provider.notAccepting",
        request.correlationId,
        true,
        true,
      ));
    }

    switch (request.method) {
      case "application.getSnapshot":
        return this.#success(request, {
          contractVersion: this.contractVersion,
          revision: this.#applicationRevision,
          capabilities: {
            revision: this.#applicationRevision,
            operations: this.#capabilities,
          },
        });
      case "task.list":
        return this.#success(request, {
          contractVersion: this.contractVersion,
          revision: this.#applicationRevision,
          tasks: this.#orderedTasks(),
        });
      case "task.get": {
        const task = this.#tasks.get(request.params.taskId);
        return task === undefined
          ? this.#failure(request, this.#error(
              "vua.task.not_found",
              "validation",
              "errors.task.notFound",
              request.correlationId,
              false,
              false,
            ))
          : this.#success(request, task);
      }
      case "task.requestCancellation":
        return this.#requestCancellation(request);
      case "environment.checkNetwork":
      case "environment.testWebsites":
        return this.#failure(request, this.#error("vua.network.unavailable", "unavailable", "errors.network.failed", request.correlationId, false, false));
      case "environment.planDeployment":
      case "environment.executeDeployment":
        return this.#failure(request, this.#error("vua.deployment.unavailable", "unavailable", "errors.deployment.failed", request.correlationId, false, false));
      case "environment.getSnapshot":
        return this.#success(request, this.#environment ?? {
          contractVersion: this.contractVersion,
          revision: this.#applicationRevision,
          capturedAt: this.#now(),
          items: [],
        });
      case "environment.verifyEditor":
        // U10 设置面 DEV 消费分支(021 词表行):桌面消费批随批接线。无注入
        // = DEV 模拟面无验证原语可达,诚实缺席(与裁决⑤缺席码语义同形);
        // 有注入 = 确定性两态 result(路径 verbatim 交注入面,零本地归一化)。
        // 真实验证事实仅出自 provider-host 路由背后的 Rust 原语。
        if (this.#environmentVerifyEditor === undefined) {
          return this.#failure(request, this.#error(
            ENVIRONMENT_VERIFY_UNAVAILABLE,
            "unavailable",
            "errors.environment.verifyUnavailable",
            request.correlationId,
            true,
            false,
          ));
        }
        return this.#success(request, this.#environmentVerifyEditor(request.params.path));
      case "overlay.getSnapshot":
        // 017 overlay 读面批 1:模拟 Provider 未接线 overlay 生产读面,
        // 诚实不可用(与真实 provider-host 未接线行为同形:code/category/
        // messageKey 三元一致;冻结语义"绝不以空快照伪装"。桌面消费测试
        // 由 DEV fixture 数据驱动,不经此分支)。
        return this.#failure(request, this.#error(
          "vua.overlay.unavailable",
          "unavailable",
          "errors.overlay.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "task.startDemo":
        return this.#startDemoTask(request);
      case "production.startInspection":
        return this.#startProductionInspection(request);
      case "production.getInspection":
        return this.#getProductionInspection(request);
      case "production.requestPlan":
        return this.#requestProductionPlan(request);
      case "production.getPlan":
        return this.#getProductionPlan(request);
      case "production.confirmPlan":
        return this.#confirmProductionPlan(request);
      case "production.recover":
        return this.#confirmProductionPlan(request);
      case "production.getBuildRecord":
        return this.#getProductionBuildRecord(request);
      // bdl-queries 只读面:模拟 Provider 无本地 BDL 存储,按协议
      // "空态即终态"如实回空集/未知健康;未知引用明确拒绝。
      // 应答形状照冻结 wire 信封(核心 2026-09-18,#36 桌面知会回正,
      // 详见 #bdlQuerySuccess 注记)
      case "catalog.list":
        return this.#bdlQuerySuccess(request, {
          schemaVersion: "0.5",
          operation: "catalog.list",
          result: { total: 0, entries: [] },
        });
      case "catalog.detail":
        // W12 对齐(核心 10325cd):detail 未命中(含墓碑)的应用面码为
        // vua.catalog.product_not_found,messageKey 随之;与真实
        // provider-host 的错误词表保持一致,DEV mock 不偏离冻结面。
        // recoverable/retryable 同样镜像 provider 的 application_error
        // (recoverable=true, retryable=false)——核心复核补齐(2026-09-08)
        return this.#failure(request, this.#error(
          "vua.catalog.product_not_found",
          "validation",
          "errors.catalog.productNotFound",
          request.correlationId,
          true,
          false,
        ));
      case "catalog.status":
        return this.#bdlQuerySuccess(request, {
          schemaVersion: "0.5",
          operation: "catalog.status",
          result: {
            health: "unknown",
            revision: { catalogUpdatedSeq: null, datasetRevision: "0.1" },
          },
        });
      case "warehouse.listEntries":
        return this.#bdlQuerySuccess(request, {
          schemaVersion: "0.5",
          operation: "warehouse.listEntries",
          result: { entries: [] },
        });
      case "project.environmentManagers":
        // mock 无项目管理检测域:诚实空(013 读面第一翼;形态对齐 wire 实际
        // 信封 = project-inspection 信封 + 内层 result 快照本体,桌面 021
        // 接线批对齐;真实采集归环境侧收集器)
        return this.#success(request, {
          schemaVersion: "0.1",
          operation: "project.environmentManagers",
          result: {
            schemaVersion: "vua.environment-managers-snapshot/v0.1",
            capturedAt: this.#now(),
            vcc: { presence: "not_found" },
            alcom: { presence: "not_found" },
            editors: [],
            projects: [],
          },
        });
      case "project.listProjects":
        // mock 无检测采集:诚实空列表(缺席语义=诚实空,不伪造条目)
        return this.#success(request, {
          schemaVersion: "vua.project-inspection/v0.2",
          projects: [],
          diagnostics: [],
        });
      case "project.inspectProject":
        // 检测面注册表缺席语义:类型化缺席(照核心 5b65550 语义注记;
        // category=validation 与核心 3484 行一致)
        return this.#failure(request, this.#error(
          "vua.project.project_not_found",
          "validation",
          "errors.project.projectNotFound",
          request.correlationId,
          false,
          false,
        ));
      case "project.lockStatus":
        // 纯观察三态:mock 无锁事实,诚实 none
        return this.#success(request, {
          schemaVersion: "vua.project-inspection/v0.2",
          projectPath: (request.params as { projectPath: string }).projectPath,
          mutationStatus: "none",
        });
      case "downloads.listCompleted":
        // mock 无下载域:诚实空列表(bdl-queries v0.4 读面;桌面穷尽性
        // 机械跟随,业务语义归数据/核心)。形状照冻结 wire 信封
        // (核心 2026-09-18,#36 桌面知会回正)
        return this.#bdlQuerySuccess(request, {
          schemaVersion: "0.5",
          operation: "downloads.listCompleted",
          result: { downloads: [] },
        });
      case "warehouse.entryDetail":
        // 同上对齐:真实 provider(10325cd)对 entryDetail 未命中回既有
        // 冻结码 vua.warehouse.entry_not_found / errors.warehouse.
        // entryNotFound,不是此处旧存的 not_found 字面量(从未存在)——
        // 核心复核补齐(2026-09-08)
        return this.#failure(request, this.#error(
          "vua.warehouse.entry_not_found",
          "validation",
          "errors.warehouse.entryNotFound",
          request.correlationId,
          true,
          false,
        ));
      case "catalog.ingestLibraryPage":
        // 模拟 Provider 无 catalog-sync 投递域:诚实不可用(同 download.* 纪律,
        // 绝不伪造落账回执)
        return this.#failure(request, this.#error(
          "vua.catalog.unavailable",
          "unavailable",
          "errors.catalog.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "warehouse.deleteOriginalsByProduct":
        return this.#failure(request, this.#error(
          "vua.warehouse.unavailable",
          "unavailable",
          "errors.warehouse.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "download.ingest":
      case "download.retry":
        // 模拟 Provider 未配置下载域:诚实不可用(同 production.* 纪律)
        return this.#failure(request, this.#error(
          "vua.download.unavailable",
          "unavailable",
          "errors.download.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "recipe.exportProjectDraft":
        // 029 B 面 recipe-export v0.1(核心冻结批 2026-09-22,桌面环 4 登记
        // TS 方法闭集时的穷尽性最小表态,业务路由归核心):模拟 Provider 无
        // 工程聚合读域,恒答冻结诚实缺席 vua.recipe_export.unavailable
        // (code/category/messageKey 三元与真实 provider-host 缺席分支一致,
        // 不折入 warehouse/recipe 族缺席码)——绝不伪造草稿(草稿转正唯一
        // 通道 = 用户显式确认后的既有 recipe.save 保存链)
        return this.#failure(request, this.#error(
          "vua.recipe_export.unavailable",
          "unavailable",
          "errors.recipeExport.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "dependencies.lookup":
      case "dependencies.listByProduct":
      // bdl-queries v0.7(N5 静默下载):同族诚实缺席纪律——mock 无 BDL
      // 观察库,文件清单不伪造
      case "catalog.productDownloadables":
      case "catalog.beginLibrarySync":
      case "catalog.finishLibrarySync":
      case "catalog.librarySyncStatus":
      case "library.beginDownload":
      case "library.observeDownload":
      case "library.downloadStatus":
      case "library.list":
      case "library.productFiles":
      case "library.removalPreview": case "library.removeFiles": case "library.removalStatus":
      case "recipeDraft.selectionStatus":
      case "recipeDraft.list": case "recipeDraft.get": case "recipeDraft.save": case "recipeDraft.addSelection":
        // bdl-queries v0.5(030 §5.7 案 A,数据席第 168 批 FROZEN,桌面消费
        // 准备切片 2026-09-22 登记 TS 方法闭集时的穷尽性最小表态,业务路由
        // 归核心接线批):模拟 Provider 无 BDL 观察库,两方法恒答诚实缺席
        // vua.catalog.unavailable(code/category/messageKey 三元与真实
        // provider-host catalog_request 缺席分支一致,bdl-queries 族同库
        // 同源)——绝不伪造线索/建议(「线索非结论」律:lookup 只出人工确
        // 认消解与过门 advisory,listByProduct 如实列库内观察,无库即诚实
        // 缺席,零合成依赖事实)
        return this.#failure(request, this.#error(
          "vua.catalog.unavailable",
          "unavailable",
          "errors.catalog.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "warehouse.setArtifactMode":
      case "warehouse.generateVpm":
      case "warehouse.deleteOriginals":
      case "warehouse.setGlobalDefaultMode":
      case "warehouse.import":
      case "warehouse.importDownloads":
      case "recipe.save":
      case "recipe.resolve":
      case "plan.approve":
      case "job.execute":
      case "recipe.get":
      case "recipe.list":
      case "plan.get":
      case "plan.list":
      case "record.get":
      case "record.list":
      case "project.import-copy":
      case "project.setNote":
        // 模拟 Provider 未配置 BDL 写域:诚实不可用(bdl-commands v0.1,
        // proposal 005;桌面登记 TS 面时的穷尽性最小表态,业务路由归核心)
        return this.#failure(request, this.#error(
          "vua.warehouse.unavailable",
          "unavailable",
          "errors.warehouse.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "inspection.get":
      case "inspection.list":
      case "inspection.requestRun":
        // M7 检查切片(016):模拟 Provider 未配置检查域(无证据库、无
        // 任务化驱动):诚实不可用,镜像 provider-host 的
        // vua.inspection.unavailable 缺席语义——不伪造检查结果
        return this.#failure(request, this.#error(
          "vua.inspection.unavailable",
          "unavailable",
          "errors.inspection.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "release.openForHandoff":
      case "release.openForInspection":
        // 023 词表行(核心冻结批 2026-09-16)＋v0.2 检视入口(核心 U19 批
        // 36bab970 入库,TS 方法闭集已随桌面登记升 0.2)。模拟 Provider 无
        // 构建记录面与产线进程/窗口面,两 editor-open 方法恒答诚实缺席
        // (code/category/messageKey 三元与真实缺席分支一致——按 v0.2
        // method 闭集应答,检视入口不再 fall-through 到 unknown_method)——
        // 绝不伪造受理回执/任务快照/交接事实/检视事实(上传状态永不进入
        // VUA 事实,形状钉死)
        return this.#failure(request, this.#error(
          "vua.release_handoff.unavailable",
          "unavailable",
          "errors.releaseHandoff.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "packages.listInstalled":
        // 024 P1 词表行(核心冻结批 2026-09-17):模拟 Provider 无 VpmBackend
        // 引擎面,恒答诚实缺席(code/category/messageKey 三元与真实
        // provider-host 未装配分支一致)——绝不伪造包清单或空数组冒充
        // (诚实空清单只属于真实后端的合法事实)
        return this.#failure(request, this.#error(
          "vua.packages.unavailable",
          "unavailable",
          "errors.packages.unavailable",
          request.correlationId,
          true,
          false,
        ));
      case "packages.listRepos":
      case "packages.packageCatalog":
      case "packages.repoCatalog":
      case "packages.listTemplates":
      case "packages.previewRemove":
      case "packages.applyRemove":
      case "packages.previewInstall":
      case "packages.applyInstall":
      case "packages.registerLocalPackage":
      case "packages.addRemoteRepo":
      case "packages.addLocalRepo":
      case "packages.removeRepo":
      case "packages.createProject":
      case "packages.enableRepo":
      case "packages.disableRepo":
      case "packages.refreshRepo":
        // 025 P2 词表行(核心冻结批 2026-09-17)＋026 A1 写面(核心冻
        // 结批 2026-09-19)＋026 A2 安装/升级面(核心冻结批 2026-09-19,
        // packages-ops v0.2)＋026 A3 本地包注册面(核心冻结批
        // 2026-09-19,packages-ops v0.3)＋026 A4 仓库订阅增删面(核心
        // 冻结批 2026-09-19,packages-ops v0.4)＋026 A5 项目创建面
        // (核心冻结批 2026-09-19,packages-ops v0.5)＋027 F2 仓库级
        // 包目录读面(核心冻结批 2026-09-20,packages-repo-catalog
        // v0.1)＋027 F5 模板枚举读面(核心冻结批 2026-09-20,
        // packages-templates v0.1)＋027 F4 仓库生命周期面(核心冻结批
        // 2026-09-20,packages-ops v0.6 启停二方法＋刷新一方法):同 P1
        // 纪律——
        // 模拟 Provider 无 VpmBackend 引擎面,恒答诚实缺席,绝不伪造仓
        // 库订阅清单/包目录事实/仓库级包目录清单/模板条目清单/变更预
        // 览/审计收据/注册收据/订阅收据/创建收据/启停收据/刷新收据或
        // 空数组冒充(诚实空清单/空 versions/诚实空态只属于真实后端的
        // 合法事实;模拟面永不模拟 wire 写回执)
        return this.#failure(request, this.#error(
          "vua.packages.unavailable",
          "unavailable",
          "errors.packages.unavailable",
          request.correlationId,
          true,
          false,
        ));
    }
  }

  /**
   * 演示任务(契约 F2):与真实任务完全相同的九态、事件、取消与关闭语义;
   * 进度由测试经 commitTaskState 驱动,不依赖真实定时器。capability
   * `demo.task` 不可用时命令被拒绝(诚实不可用,而非静默成功)。
   */
  /**
   * 生产命令任务创建(幂等):queued 状态入栈 + accepted 事件;
   * 与 demo 任务同一套任务机制,进度由调用方驱动到终态。
   */
  #acceptProductionTask(
    commandKind: string,
    commandId: string,
    taskId: string,
    correlationId: string,
  ): TaskSnapshotV01 {
    const task: TaskSnapshotV01 = {
      contractVersion: this.contractVersion,
      taskId,
      revision: 1,
      correlationId,
      state: "queued",
      cancellationRequested: false,
      recoveryDisposition: "none",
      updatedAt: this.#now(),
    };
    this.#tasks.set(taskId, task);
    this.#mutatingTaskIds.add(taskId);
    this.#applicationRevision += 1;
    this.#emit({
      contractVersion: this.contractVersion,
      eventId: this.#nextEventId(),
      taskId,
      revision: task.revision,
      occurredAt: task.updatedAt,
      correlationId,
      kind: "task.accepted",
      state: task.state,
      payload: {},
    });
    return task;
  }

  #startDemoTask(
    request: Extract<ApplicationRequestV01, { method: "task.startDemo" }>,
  ): ApplicationResponseV01 {
    const demoAvailable = this.#capabilities.some(
      (operation) => operation.operationId === "demo.task" && operation.availability === "available",
    );
    if (!demoAvailable) {
      return this.#failure(request, this.#error(
        "vua.demo.unavailable",
        "unavailable",
        "errors.demo.unavailable",
        request.correlationId,
        true,
        false,
      ));
    }

    const replay = this.#demoCommandResults.get(request.commandId);
    if (replay !== undefined) {
      const task = this.#tasks.get(replay.task.taskId);
      return this.#success(request, {
        contractVersion: this.contractVersion,
        task: task ?? replay.task,
      });
    }

    this.#demoTaskSequence += 1;
    const task: TaskSnapshotV01 = {
      contractVersion: this.contractVersion,
      taskId: `demo-${this.#demoTaskSequence}`,
      revision: 1,
      correlationId: request.correlationId,
      state: "queued",
      cancellationRequested: false,
      recoveryDisposition: "none",
      updatedAt: this.#now(),
    };
    this.#tasks.set(task.taskId, task);
    this.#mutatingTaskIds.add(task.taskId);
    this.#applicationRevision += 1;
    const started: DemoTaskStartedV01 = {
      contractVersion: this.contractVersion,
      task,
    };
    this.#demoCommandResults.set(request.commandId, started);
    this.#emit({
      contractVersion: this.contractVersion,
      eventId: this.#nextEventId(),
      taskId: task.taskId,
      revision: task.revision,
      occurredAt: task.updatedAt,
      correlationId: task.correlationId,
      kind: "task.accepted",
      state: task.state,
      payload: {},
    });
    return this.#success(request, started);
  }

  subscribe(listener: ProviderEventListenerV01): ProviderUnsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async prepareShutdown(request: { readonly timeoutMs: number }): Promise<ProviderShutdownResultV01> {
    this.#requireTimeout(request.timeoutMs);
    this.#acceptingCalls = false;
    this.#state = "stopping";
    return this.#shutdownReadiness();
  }

  async continueShutdown(request: ContinueShutdownRequestV01): Promise<ProviderShutdownResultV01> {
    if (this.#state !== "stopping") throw new Error("shutdown was not prepared");
    if (request.decision === "wait") {
      this.#requireTimeout(request.timeoutMs);
      return this.#shutdownReadiness();
    }
    if (request.userDecisionId.trim().length === 0) {
      throw new Error("force shutdown requires a user decision id");
    }
    const interruptedTasks = this.#blockingTasks();
    this.#state = "stopped";
    return {
      contractVersion: this.contractVersion,
      outcome: "forced",
      userDecisionId: request.userDecisionId,
      interruptedTasks,
    };
  }

  /**
   * 测试驱动任务状态迁移(五种生产生命周期呈现的脚本化入口)。
   * patch 允许脚本化恢复事实:漂移场景 = failed + inspect_required
   * (渲染层投影 failed_recoverable);错误负载随 task.completed 事件携带。
   */
  commitTaskState(
    taskId: string,
    state: TaskStateV01,
    patch: {
      readonly recoveryDisposition?: TaskRecoveryDispositionV01;
      readonly error?: AppErrorV01;
    } = {},
  ): void {
    const task = this.#tasks.get(taskId);
    if (task === undefined) throw new Error(`unknown mock task: ${taskId}`);
    if (isTerminalTaskStateV01(task.state)) throw new Error(`mock task is already terminal: ${taskId}`);
    const next: TaskSnapshotV01 = {
      ...task,
      revision: task.revision + 1,
      state,
      ...(patch.recoveryDisposition !== undefined
        ? { recoveryDisposition: patch.recoveryDisposition }
        : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updatedAt: this.#now(),
    };
    this.#tasks.set(taskId, next);
    this.#applicationRevision += 1;
    this.#emit({
      contractVersion: this.contractVersion,
      eventId: this.#nextEventId(),
      taskId,
      revision: next.revision,
      occurredAt: next.updatedAt,
      correlationId: next.correlationId,
      kind: isTerminalTaskStateV01(state) ? "task.completed" : "task.stateChanged",
      state,
      payload: {},
    });
  }

  #productionUnavailable(request: Extract<ApplicationRequestV01, { method: `production.${string}` }>): ApplicationResponseV01 | null {
    const productionAvailable = this.#capabilities.some(
      (operation) => operation.operationId === "production.useCase" && operation.availability === "available",
    );
    if (productionAvailable) return null;
    return this.#failure(request, this.#error(
      "vua.production.unavailable",
      "unavailable",
      "errors.production.unavailable",
      request.correlationId,
      true,
      false,
    ));
  }

  /** 幂等重放:同一 commandId 返回同形回执(域身份 + 当前任务快照) */
  #replayOrUndefined(
    request: Extract<ApplicationRequestV01, { method: "production.startInspection" | "production.requestPlan" | "production.confirmPlan" | "production.recover" }>,
  ): ApplicationResponseV01 | null {
    const issued = this.#productionCommands.get(request.commandId);
    if (issued === undefined) return null;
    const task = this.#tasks.get(issued.taskId);
    if (task === undefined) return null;
    const base = { contractVersion: this.contractVersion, task };
    if (issued.inspectionId !== undefined) {
      return this.#success(request, { ...base, inspectionId: issued.inspectionId });
    }
    if (issued.planId !== undefined) {
      return this.#success(request, {
        ...base,
        planId: issued.planId,
        revision: issued.revision ?? 1,
      });
    }
    return this.#success(request, base);
  }

  /** 域身份签发:前缀 + 16 位小写十六进制(Schema $defs 模式) */
  #nextDomainId(prefix: "insp" | "plan"): string {
    this.#domainSequence += 1;
    return `${prefix}-${this.#domainSequence.toString(16).padStart(16, "0")}`;
  }

  #invalidParams(request: ApplicationRequestV01): ApplicationResponseV01 {
    return this.#failure(request, this.#error(
      "vua.production.invalid_params",
      "validation",
      "errors.production.invalidParams",
      request.correlationId,
      false,
      false,
    ));
  }

  #recordNotFound(request: ApplicationRequestV01): ApplicationResponseV01 {
    return this.#failure(request, this.#error(
      "vua.production.record_not_found",
      "validation",
      "errors.production.recordNotFound",
      request.correlationId,
      false,
      false,
    ));
  }

  /**
   * 模拟执行器瞬时完成:queued → succeeded 同步迁移并发出 completed 事件
   * (真实链路由 worker 线程驱动到终态;mock 保持确定性回放)。
   */
  #completeProductionTask(taskId: string): TaskSnapshotV01 {
    const task = this.#tasks.get(taskId);
    if (task === undefined) throw new Error(`unknown mock task: ${taskId}`);
    const next: TaskSnapshotV01 = {
      ...task,
      revision: task.revision + 1,
      state: "succeeded",
      updatedAt: this.#now(),
    };
    this.#tasks.set(taskId, next);
    this.#applicationRevision += 1;
    this.#emit({
      contractVersion: this.contractVersion,
      eventId: this.#nextEventId(),
      taskId,
      revision: next.revision,
      occurredAt: next.updatedAt,
      correlationId: next.correlationId,
      kind: "task.completed",
      state: next.state,
      payload: {},
    });
    return next;
  }

  #startProductionInspection(
    request: Extract<ApplicationRequestV01, { method: "production.startInspection" }>,
  ): ApplicationResponseV01 {
    const unavailable = this.#productionUnavailable(request);
    if (unavailable !== null) return unavailable;
    const replay = this.#replayOrUndefined(request);
    if (replay !== null) return replay;

    // v0.2 参数面:四元组必填且非空(缺参在任务创建前拒绝)
    const params = request.params;
    if ([params.sourceFolder, params.projectRoot, params.artifactOutputRoot, params.projectId]
      .some((value) => typeof value !== "string" || value.length === 0)) {
      return this.#invalidParams(request);
    }

    this.#productionSequence += 1;
    const taskId = `production-${this.#productionSequence}`;
    const inspectionId = this.#nextDomainId("insp");
    this.#acceptProductionTask(
      "production.startInspection",
      request.commandId,
      taskId,
      request.correlationId,
    );
    const task = this.#completeProductionTask(taskId);
    this.#productionCommands.set(request.commandId, { taskId, inspectionId });
    // 一次性绑定:四元组随本次请求登记,后续命令不再携带路径
    this.#domainRecords.set(inspectionId, {
      kind: "inspection",
      taskId,
      binding: {
        sourceFolder: params.sourceFolder,
        projectRoot: params.projectRoot,
        artifactOutputRoot: params.artifactOutputRoot,
        projectId: params.projectId,
        createdAt: this.#now(),
      },
      document: {
        inspectionId,
        inspectedAt: this.#now(),
        displayName: `合成素材包 ${this.#productionSequence}(模拟 Provider)`,
        sourceFingerprint: `sha256:mock-source-${this.#productionSequence}`,
        riskFingerprint: `sha256:mock-risk-${this.#productionSequence}`,
        packages: [
          {
            relativePath: "pack.unitypackage",
            sizeBytes: 1024,
            sha256: `sha256:mock-pack-${this.#productionSequence}`,
          },
        ],
        findings: [],
        plannability: "plannable",
      },
    });
    return this.#success(request, { contractVersion: this.contractVersion, task, inspectionId });
  }

  #getProductionInspection(
    request: Extract<ApplicationRequestV01, { method: "production.getInspection" }>,
  ): ApplicationResponseV01 {
    const record = this.#domainRecords.get(request.params.inspectionId);
    if (record === undefined || record.kind !== "inspection") return this.#recordNotFound(request);
    const task = this.#tasks.get(record.taskId);
    return this.#success(request, {
      contractVersion: this.contractVersion,
      taskId: record.taskId,
      state: task?.state ?? "unknown",
      inspection: record.document as InspectionDocumentV02,
    });
  }

  #requestProductionPlan(
    request: Extract<ApplicationRequestV01, { method: "production.requestPlan" }>,
  ): ApplicationResponseV01 {
    const unavailable = this.#productionUnavailable(request);
    if (unavailable !== null) return unavailable;
    const replay = this.#replayOrUndefined(request);
    if (replay !== null) return replay;

    // v0.2:{ inspectionId, mode };项目身份与全部路径来自检查绑定
    const { inspectionId, mode } = request.params;
    if (!PRODUCTION_MODES_V02.includes(mode)) return this.#invalidParams(request);
    const inspection = this.#domainRecords.get(inspectionId);
    if (inspection === undefined || inspection.kind !== "inspection") {
      return this.#recordNotFound(request);
    }

    this.#productionSequence += 1;
    const taskId = `production-plan-${this.#productionSequence}`;
    const planId = this.#nextDomainId("plan");
    this.#acceptProductionTask(
      "production.requestPlan",
      request.commandId,
      taskId,
      request.correlationId,
    );
    // 确认绑定 revision = 计划任务完成后的修订(Rust 同形:worker 终态即登记)
    const task = this.#completeProductionTask(taskId);
    const revision = task.revision;
    this.#productionCommands.set(request.commandId, { taskId, planId, revision });
    const projectId = inspection.binding["projectId"];
    this.#domainRecords.set(planId, {
      kind: "plan",
      taskId,
      binding: { inspectionId, revision },
      document: {
        planId,
        revision,
        inspectionId,
        mode,
        projectId: typeof projectId === "string" ? projectId : "unknown",
        projectFingerprint: `sha256:mock-project-${this.#productionSequence}`,
        stages: ["snapshot", "execute", "validate"],
        riskDecisionRequired: true,
        risks: [],
        diffs: [],
        // 诚实预估:模拟 Provider 无真实总量来源,null 锚(向量断言同值)
        estimatedDurationMs: null,
      },
    });
    return this.#success(request, {
      contractVersion: this.contractVersion,
      task,
      planId,
      revision,
    });
  }

  #getProductionPlan(
    request: Extract<ApplicationRequestV01, { method: "production.getPlan" }>,
  ): ApplicationResponseV01 {
    const record = this.#domainRecords.get(request.params.planId);
    if (record === undefined || record.kind !== "plan") return this.#recordNotFound(request);
    const task = this.#tasks.get(record.taskId);
    return this.#success(request, {
      contractVersion: this.contractVersion,
      taskId: record.taskId,
      state: task?.state ?? "unknown",
      plan: record.document as PlanDocumentV02,
    });
  }

  #confirmProductionPlan(
    request: Extract<ApplicationRequestV01, { method: "production.confirmPlan" | "production.recover" }>,
  ): ApplicationResponseV01 {
    const unavailable = this.#productionUnavailable(request);
    if (unavailable !== null) return unavailable;
    const replay = this.#replayOrUndefined(request);
    if (replay !== null) return replay;

    let planRecord: MockDomainRecord | undefined;
    let planId = "";
    if (request.method === "production.confirmPlan") {
      // v0.2:observedRevision 与 riskChoice 必填;过期确认在任务创建前拒绝
      const { planId: requestedPlanId, observedRevision, riskChoice } = request.params;
      if (typeof observedRevision !== "number"
        || !Number.isSafeInteger(observedRevision)
        || observedRevision < 1) {
        return this.#invalidParams(request);
      }
      if (!PRODUCTION_RISK_CHOICES_V02.includes(riskChoice)) return this.#invalidParams(request);
      if (!PLAN_ID_PATTERN.test(requestedPlanId)) return this.#recordNotFound(request);
      planRecord = this.#domainRecords.get(requestedPlanId);
      if (planRecord === undefined || planRecord.kind !== "plan") {
        return this.#recordNotFound(request);
      }
      if (planRecord.binding["revision"] !== observedRevision) {
        return this.#failure(request, this.#error(
          "vua.production.plan_mismatch",
          "validation",
          "errors.production.planMismatch",
          request.correlationId,
          false,
          false,
        ));
      }
      planId = requestedPlanId;
    } else {
      // 恢复:decisionId 必填(Kernel 受理时生成);绑定原始失败任务——
      // 引用不存在为 not_found,存在但未处于 failed/cancelled 终态不可恢复
      const { taskId, decision, decisionId } = request.params;
      if (typeof decisionId !== "string" || decisionId.length === 0) {
        return this.#failure(request, this.#error(
          "vua.production.decision_id_required",
          "validation",
          "errors.production.decisionIdRequired",
          request.correlationId,
          false,
          false,
        ));
      }
      if (decision !== "continue" && decision !== "rollback") {
        return this.#invalidParams(request);
      }
      const original = this.#tasks.get(taskId);
      if (original === undefined) {
        return this.#failure(request, this.#error(
          "vua.task.not_found",
          "validation",
          "errors.task.notFound",
          request.correlationId,
          false,
          false,
        ));
      }
      if (!(original.state === "failed" || original.state === "cancelled")) {
        return this.#failure(request, this.#error(
          "vua.production.not_recoverable",
          "validation",
          "errors.production.notRecoverable",
          request.correlationId,
          false,
          false,
        ));
      }
    }

    this.#productionSequence += 1;
    const taskId = `production-confirm-${this.#productionSequence}`;
    this.#acceptProductionTask(
      request.method,
      request.commandId,
      taskId,
      request.correlationId,
    );
    // autoComplete:worker 完成语义的快进(向量 waitTerminal);默认保持
    // queued 由调用方脚本化驱动
    const task = this.#productionAutoComplete
      ? this.#completeProductionTask(taskId)
      : this.#tasks.get(taskId)!;
    this.#productionCommands.set(request.commandId, { taskId });

    // 执行结案即合成构建记录 v0.2(evidenceSummary 四节;未尝试节 null 锚);
    // planId 别名同键(渲染层的 recordRef 即 planId)
    if (planRecord !== undefined && planRecord.kind === "plan") {
      const planDocument = planRecord.document as PlanDocumentV02;
      const recordId = `record-${planId}`;
      const buildRecord: BuildRecordDocumentV02 = {
        recordId,
        taskId,
        planId,
        mode: planDocument.mode,
        status: "succeeded",
        stages: ["snapshot", "execute", "validate"],
        evidenceSummary: {
          snapshot: { attempted: true, succeeded: true },
          bridge: {
            jobsRun: 2,
            allSucceeded: true,
            lastOperation: "合成 Bridge 作业(模拟 Provider)",
          },
          localVpm: { attempted: false, published: null, packageId: null },
          validation: { status: "passed" },
        },
        restoreAttempted: false,
        restoreSucceeded: null,
        startedAt: this.#now(),
        finishedAt: this.#now(),
      };
      this.#buildRecords.set(recordId, buildRecord);
      this.#buildRecords.set(planId, buildRecord);
    }
    return this.#success(request, { contractVersion: this.contractVersion, task });
  }

  #getProductionBuildRecord(
    request: Extract<ApplicationRequestV01, { method: "production.getBuildRecord" }>,
  ): ApplicationResponseV01 {
    const record = this.#buildRecords.get(request.params.buildRecordId);
    if (record === undefined) return this.#recordNotFound(request);
    return this.#success(request, {
      contractVersion: this.contractVersion,
      buildRecord: record,
    });
  }

  #requestCancellation(
    request: Extract<ApplicationRequestV01, { method: "task.requestCancellation" }>,
  ): ApplicationResponseV01 {
    const replay = this.#commandResults.get(request.commandId);
    if (replay !== undefined) {
      if (replay.taskId !== request.params.taskId) {
        return this.#failure(request, this.#error(
          "vua.command.id_conflict",
          "conflict",
          "errors.command.idConflict",
          request.correlationId,
          true,
          false,
        ));
      }
      return this.#success(request, replay.result);
    }

    const task = this.#tasks.get(request.params.taskId);
    if (task === undefined) {
      return this.#failure(request, this.#error(
        "vua.task.not_found",
        "validation",
        "errors.task.notFound",
        request.correlationId,
        false,
        false,
      ));
    }

    if (isTerminalTaskStateV01(task.state)) {
      const result = this.#cancellationResult(task, "already_terminal");
      this.#commandResults.set(request.commandId, { taskId: task.taskId, result });
      return this.#success(request, result);
    }

    if (task.cancellationRequested) {
      const result = this.#cancellationResult(task, "already_requested");
      this.#commandResults.set(request.commandId, { taskId: task.taskId, result });
      return this.#success(request, result);
    }

    const next: TaskSnapshotV01 = {
      ...task,
      revision: task.revision + 1,
      cancellationRequested: true,
      updatedAt: this.#now(),
    };
    this.#tasks.set(next.taskId, next);
    this.#applicationRevision += 1;
    const result = this.#cancellationResult(next, "requested");
    this.#commandResults.set(request.commandId, { taskId: next.taskId, result });
    this.#emit({
      contractVersion: this.contractVersion,
      eventId: this.#nextEventId(),
      taskId: next.taskId,
      revision: next.revision,
      occurredAt: next.updatedAt,
      correlationId: next.correlationId,
      kind: "task.cancellationRequested",
      state: next.state,
      payload: {
        commandId: request.commandId,
        ...(request.params.observedRevision === undefined
          ? {}
          : { observedRevision: request.params.observedRevision }),
      },
    });
    return this.#success(request, result);
  }

  #cancellationResult(task: TaskSnapshotV01, outcome: TaskCancellationResultV01["outcome"]): TaskCancellationResultV01 {
    return {
      contractVersion: this.contractVersion,
      taskId: task.taskId,
      revision: task.revision,
      state: task.state,
      outcome,
    };
  }

  #orderedTasks(): readonly TaskSnapshotV01[] {
    return [...this.#tasks.values()].sort((left, right) => left.taskId.localeCompare(right.taskId));
  }

  #blockingTasks(): readonly BlockingTaskV01[] {
    return this.#orderedTasks()
      .filter((task) => this.#mutatingTaskIds.has(task.taskId) && !isTerminalTaskStateV01(task.state))
      .map((task) => ({ taskId: task.taskId, revision: task.revision, state: task.state }));
  }

  #shutdownReadiness(): ProviderShutdownResultV01 {
    const blockingTasks = this.#blockingTasks();
    if (blockingTasks.length > 0) {
      return {
        contractVersion: this.contractVersion,
        outcome: "needs_user_choice",
        blockingTasks,
      };
    }
    this.#state = "stopped";
    return {
      contractVersion: this.contractVersion,
      outcome: "safe_to_stop",
      blockingTasks: [],
    };
  }

  #requireTimeout(timeoutMs: number): void {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("shutdown timeout must be a positive integer");
    }
  }

  #nextEventId(): string {
    this.#eventSequence += 1;
    return `mock-event-${this.#eventSequence}`;
  }

  #emit(event: ApplicationEventV01): void {
    for (const listener of this.#listeners) listener(event);
  }

  /**
   * bdl-queries 冻结 wire 信封(核心 2026-09-18,BOARD #36 桌面知会回正;
   * 2026-09-22 核心 v0.5 接线批随版:信封常量 0.4→0.5,六个既有方法
   * 词面零变化,字面随之——桌面 TS 面归桌面接线批):
   * 数据域冻结 schema(schemas/bdl-queries/v0.5/result.schema.json)钉
   * wire 应答顶层为 {schemaVersion "0.5", operation, result}(required
   * schemaVersion+operation、additionalProperties false、result 按方法
   * 分支),provider-host bdl_query_success(provider_host.rs)同形实现,
   * 且 supervised 链 invoke 零解包原样透传——OrchestratorProviderV01
   * value 面的权威形状 = 信封。mock 此前四个只读成功分支平铺回 result
   * 本体,系 #22 同构的 live/fixture 形状分裂(桌面按信封窄化消费后
   * dev 面恒诚实 unavailable);照本文件 project.environmentManagers
   * 021 批先例对齐 wire 实际信封。
   * 去桥完成(同日桌面 f8ad6cb 后):packages/contracts bdl 六结果类型
   * 已照 021 先例登记信封形状(类型注释载权威链),helper 直接收类型化
   * 信封联合、零强转——信封字面量偏离冻结成员类型即编译错;运行时形状
   * 仍以冻结 schema 为准,不回退。
   */
  #bdlQuerySuccess(
    request: ApplicationRequestV01,
    envelope:
      | CatalogListResultV03
      | CatalogStatusResultV03
      | WarehouseListEntriesResultV03
      | DownloadsListCompletedResultV04,
  ): ApplicationResponseV01 {
    return this.#success(request, envelope);
  }

  #success(
    request: ApplicationRequestV01,
    value: Extract<ApplicationResponseV01, { ok: true }>["value"],
  ): ApplicationResponseV01 {
    return {
      contractVersion: this.contractVersion,
      requestId: request.requestId,
      ok: true,
      value,
    };
  }

  #failure(request: ApplicationRequestV01, error: AppErrorV01): ApplicationResponseV01 {
    return {
      contractVersion: this.contractVersion,
      requestId: request.requestId,
      ok: false,
      error,
    };
  }

  #error(
    code: string,
    category: AppErrorV01["category"],
    messageKey: string,
    correlationId: string,
    recoverable: boolean,
    retryable: boolean,
  ): AppErrorV01 {
    return {
      contractVersion: this.contractVersion,
      code,
      category,
      messageKey,
      recoverable,
      retryable,
      correlationId,
    };
  }
}
