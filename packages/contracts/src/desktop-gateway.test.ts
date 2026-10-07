import { describe, expect, it } from "vitest";
import {
  DESKTOP_GATEWAY_MAX_REQUEST_BYTES,
  isDesktopGatewayRequestV1,
  requestByteLength,
  type DesktopFsApiV1,
  type DesktopFsListV1,
  type DesktopFsResultV1,
  type DesktopWindowApiV1,
  type GameGuideWindowShowResultV1,
  type OverlayViewV1,
  type OverlayWindowShowResultV1,
  type ReaderWindowShowResultV1,
} from "./desktop-gateway.js";

describe("DesktopWindowApiV1 overlay faces (2026-09-26 additive: showOverlay + view events)", () => {
  // 形状锚(additive 面,与 DesktopFsApiV1 同批纪律):方法面可判别、视图
  // 词表闭集二值、回执双键——类型由 TS 编译期强制,此处钉运行期词面
  it("api surface keeps toggleOverlay and adds showOverlay with view events (shape drift guard)", () => {
    // 编译期即锁定形状;运行期钉方法名存在性,防 preload 面漂移
    // 首玩 B 切片 additive:showGuide/hideOverlay/guideTargetEvents/
    // focusMainWindow 扩展,既有成员原样保留(旧调用兼容)
    // 三类引导裁决 additive:showReader/readerTargetEvents(准备阅读器,
    // 普通窗口),覆盖层既有成员原样保留
    const apiShape: Record<keyof DesktopWindowApiV1, true> = {
      minimize: true,
      toggleMaximize: true,
      close: true,
      toggleOverlay: true,
      showOverlay: true,
      overlayViewEvents: true,
      showGuide: true,
      hideOverlay: true,
      guideTargetEvents: true,
      showReader: true,
      readerTargetEvents: true,
      showGameGuide: true,
      hideGameGuide: true,
      setGameGuideFollowing: true,
      getGameGuideFollowStatus: true,
      focusMainWindow: true,
    };
    expect(Object.keys(apiShape)).toEqual([
      "minimize",
      "toggleMaximize",
      "close",
      "toggleOverlay",
      "showOverlay",
      "overlayViewEvents",
      "showGuide",
      "hideOverlay",
      "guideTargetEvents",
      "showReader",
      "readerTargetEvents",
      "showGameGuide",
      "hideGameGuide",
      "setGameGuideFollowing",
      "getGameGuideFollowStatus",
      "focusMainWindow",
    ]);
  });

  it("view vocabulary is the closed two-value set and the show receipt carries visibility + view", () => {
    const views: readonly OverlayViewV1[] = ["guide", "status"];
    expect(views).toHaveLength(2);
    const created: OverlayWindowShowResultV1 = { visible: true, view: "guide" };
    const switched: OverlayWindowShowResultV1 = { visible: true, view: "status" };
    expect(created.visible).toBe(true);
    expect(created.view).toBe("guide");
    expect(switched.view).toBe("status");
  });

  it("reader show receipt carries visibility only (no hide semantics; close is the OS frame)", () => {
    const opened: ReaderWindowShowResultV1 = { visible: true };
    expect(opened.visible).toBe(true);
  });

  it("game guide show receipt carries visibility only (hide is an explicit in-window action)", () => {
    const opened: GameGuideWindowShowResultV1 = { visible: true };
    expect(opened.visible).toBe(true);
  });
});

describe("DesktopFsApiV1 (2026-09-25 用户裁决:素材导入应用内文件夹选择器)", () => {
  // 形状锚(additive 面,与 DesktopSystemApiV1 同批纪律):结果信封可判别、
  // 错误闭集六值、列表三键——类型由 TS 编译期强制,此处钉运行期词面与信封语义
  const list: DesktopFsListV1 = {
    path: "C:/Users/synthetic",
    parent: "C:/Users",
    entries: [{ name: "material-pack", path: "C:/Users/synthetic/material-pack", hidden: false }],
  };
  const okResult: DesktopFsResultV1<DesktopFsListV1> = { ok: true, value: list };
  const denied: DesktopFsResultV1<DesktopFsListV1> = { ok: false, error: "access_denied" };

  it("result envelope discriminates ok/value from error", () => {
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.path).toBe("C:/Users/synthetic");
      expect(okResult.value.parent).toBe("C:/Users");
      expect(okResult.value.entries).toHaveLength(1);
      expect(okResult.value.entries[0]?.hidden).toBe(false);
    }
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe("access_denied");
    }
  });

  it("error vocabulary is the closed six-value set", () => {
    const all: readonly DesktopFsResultV1<unknown>[] = [
      { ok: false, error: "not_found" },
      { ok: false, error: "not_a_directory" },
      { ok: false, error: "access_denied" },
      { ok: false, error: "invalid_name" },
      { ok: false, error: "already_exists" },
      { ok: false, error: "failed" },
    ];
    for (const result of all) {
      expect(result.ok).toBe(false);
    }
  });

  it("api surface declares listDirectory and createDirectory (shape drift guard)", () => {
    // 编译期即锁定形状;运行期钉方法名存在性,防 preload 面漂移
    const apiShape: Record<keyof DesktopFsApiV1, true> = {
      listDirectory: true,
      createDirectory: true,
    };
    expect(Object.keys(apiShape)).toEqual(["listDirectory", "createDirectory"]);
  });
});

describe("desktop Gateway v1", () => {
  it("accepts the single M1 query", () => {
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "request-1",
        method: "app.snapshot",
        params: {},
      }),
    ).toBe(true);
  });

  it("rejects unknown methods and oversized envelopes", () => {
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "request-2",
        method: "shell.execute",
        params: {},
      }),
    ).toBe(false);
    expect(requestByteLength({ payload: "x".repeat(DESKTOP_GATEWAY_MAX_REQUEST_BYTES) })).toBeGreaterThan(
      DESKTOP_GATEWAY_MAX_REQUEST_BYTES,
    );
  });

  it("accepts the F2 method table with per-method params", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-3", method: "task.list", params: {},
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-4", method: "task.get", params: { taskId: "task-1" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "request-5",
      method: "task.requestCancellation",
      params: { taskId: "task-1", commandId: "cancel-1", observedRevision: 8 },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-6", method: "task.requestCancellation", params: { taskId: "task-1", commandId: "cancel-1" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-7", method: "environment.getSnapshot", params: {},
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-8", method: "task.startDemo", params: { commandId: "demo-1" },
    })).toBe(true);
  });

  it("rejects F2 methods with missing, extra, or malformed params", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-9", method: "task.get", params: {},
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-10", method: "task.get", params: { taskId: "" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "request-11",
      method: "task.requestCancellation",
      params: { taskId: "task-1", commandId: "cancel-1", observedRevision: -1 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-12", method: "task.startDemo", params: { commandId: "demo-1", force: true },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-13", method: "task.startDemo", params: {},
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-14", method: "environment.getSnapshot", params: { zone: "play" },
    })).toBe(false);
  });

  it("keeps the app.snapshot query untouched", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-15", method: "app.snapshot", params: { extra: 1 },
    })).toBe(false);
  });

  // 017 overlay 表面批 1 消费接线:查询闭集为空,空参 verbatim 透传 Kernel
  it("accepts overlay.getSnapshot with empty params and rejects extras (017 batch 1)", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-16", method: "overlay.getSnapshot", params: {},
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-17", method: "overlay.getSnapshot", params: { taskId: "task-1" },
    })).toBe(false);
  });

  // M7 检查切片消费批(inspection-queries v0.1;016 仲裁独立词表行):读面
  // get/list 入桌面词表。requestRun 任务化写命令不入——avatarGlobalObjectId
  // 无桌面事实源,登记而不消费即悬空面(016 核心表态 3 同构纪律)。
  const INSP_ID = "01982b5a-3f10-7c4e-9d2a-4b8e1f6a7c21";

  it("accepts inspection.get with the single identity param and rejects extras/fuzz (M7)", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-1", method: "inspection.get",
      params: { inspectionId: INSP_ID },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-2", method: "inspection.get", params: {},
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-3", method: "inspection.get",
      params: { inspectionId: INSP_ID, text: "fuzzy" },
    })).toBe(false);
  });

  it("accepts inspection.list with the closed optional set and rejects unknown keys (M7)", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-4", method: "inspection.list", params: {},
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-5", method: "inspection.list",
      params: { avatarRef: "warehouse:booth-item-1001", overallStatus: "fail", limit: 50, offset: 0 },
    })).toBe(true);
    // unavailable 是维状态非聚合输出——不进过滤闭集(016 §4 聚合规则)。
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-6", method: "inspection.list",
      params: { overallStatus: "unavailable" },
    })).toBe(false);
    // limit 有界 1..200(数据草案 schema minimum 1 / maximum 200)。
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-7", method: "inspection.list", params: { limit: 201 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-8", method: "inspection.list", params: { limit: 0 },
    })).toBe(false);
    // 词表外 text 模糊过滤拒绝(草案面无此语义,不发明)。
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "request-insp-9", method: "inspection.list", params: { text: "fuzzy" },
    })).toBe(false);
  });
});

describe("production.* v0.2 方法守卫", () => {
  const base = {
    schemaVersion: 1,
    requestId: "request-prod-1",
    kind: "command",
    method: "production.startInspection",
    params: { materialRefId: "mat-1", commandId: "command-1" },
  };
  const variants: Record<string, Record<string, unknown>> = {
    "production.getInspection": { inspectionId: "insp-0123456789abcdef" },
    "production.requestPlan": {
      inspectionId: "insp-0123456789abcdef",
      commandId: "command-2",
      mode: "direct_unity_package",
    },
    "production.getPlan": { planId: "plan-0123456789abcdef" },
    "production.confirmPlan": {
      planId: "plan-0123456789abcdef",
      commandId: "command-3",
      observedRevision: 8,
      riskChoice: "snapshot_and_continue",
    },
    "production.recover": { taskId: "task-1", decision: "rollback", commandId: "command-4" },
    "production.getBuildRecord": { buildRecordId: "record-1" },
  };

  it("accepts each production method with its exact params", () => {
    for (const [method, params] of Object.entries(variants)) {
      const request = {
        schemaVersion: 1,
        requestId: "request-prod",
        method,
        params,
      };
      expect(isDesktopGatewayRequestV1(request)).toBe(true);
    }
  });

  it("accepts the optional rememberForSession on confirmPlan", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r",
      method: "production.confirmPlan",
      params: {
        planId: "plan-0123456789abcdef",
        commandId: "command-5",
        observedRevision: 8,
        riskChoice: "continue",
        rememberForSession: true,
      },
    })).toBe(true);
  });

  it("rejects malformed production params and unknown production methods", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.startInspection", params: {},
    })).toBe(false);
    // v0.2:observedRevision 必填、riskChoice 必填且在四枚举内
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.confirmPlan",
      params: { planId: "plan-0123456789abcdef", commandId: "c", riskChoice: "continue" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.confirmPlan",
      params: { planId: "plan-0123456789abcdef", commandId: "c", observedRevision: 8, riskChoice: "snapshot_first" },
    })).toBe(false);
    // v0.2:mode 必填且在双素材词表内
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.requestPlan",
      params: { inspectionId: "insp-0123456789abcdef", commandId: "c" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.requestPlan",
      params: { inspectionId: "insp-0123456789abcdef", commandId: "c", mode: "mystery_mode" },
    })).toBe(false);
    // v0.2:recover 瘦身为语义选择,渲染层携带的路径/决定 ID 一律拒绝
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.recover",
      params: { taskId: "t", decision: "continue" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.recover",
      params: { taskId: "t", decision: "sideways", commandId: "c" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.recover",
      params: { taskId: "t", decision: "rollback", commandId: "c", sourceFolder: "C:/x" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1, requestId: "r", method: "production.unknown", params: {},
    })).toBe(false);
  });
});

// bdl-queries v0.5 gateway surface(桌面 TS 登记面 2026-09-22;数据席第 168
// 批 FROZEN,030 §5.7 案 A):dependencies.lookup/listByProduct 两方法只读,
// 守卫与冻结 Schema additionalProperties:false 同形——词外键(含 fuzzy 等价
// 开关,负例向量钉死)、词外 depKind(恰钉五值草案成员 unity_or_sdk_version
// 拒绝 = BDL v0.2 N1 同一裁决面)、分页越界、身份形态不齐一律拒绝,绝不
// 静默空答;listByProduct 无 name/过滤键(客户端过滤 = 契约错误)。
describe("bdl-queries v0.5 gateway surface", () => {
  const base = { schemaVersion: 1, requestId: "r" } as const;

  it("accepts both read-only queries within the frozen closed sets (request example vectors)", () => {
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "lilToon", depKind: null, limit: 50, offset: 0 },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "liltoon", depKind: "shader" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "Unity", depKind: "other", limit: 1, offset: 200 },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.listByProduct",
      params: { productId: "booth:6584744" },
    })).toBe(true);
  });

  it("rejects the frozen negative-vector faces: empty name, foreign depKind, fuzzy key, out-of-range paging", () => {
    // 负例 invalid-dependencies-lookup-empty-name
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.lookup", params: { name: "" },
    })).toBe(false);
    // 负例 invalid-dependencies-lookup-foreign-dep-kind:五值草案成员
    // unity_or_sdk_version 在 BDL v0.2 N1 已裁决为词外
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "Unity", depKind: "unity_or_sdk_version" },
    })).toBe(false);
    // 负例 invalid-dependencies-lookup-fuzzy-param:本词表刻意不携带任何
    // 模糊/等价开关
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "lilToon", fuzzy: true },
    })).toBe(false);
    // 词表外其余键一律拒绝(additionalProperties:false 同形)
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.lookup",
      params: { name: "lilToon", text: "lil" },
    })).toBe(false);
    // name 必填;limit 1–200;offset ≥ 0
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.lookup", params: {},
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.lookup", params: { name: "x", limit: 0 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.lookup", params: { name: "x", limit: 201 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.lookup", params: { name: "x", offset: -1 },
    })).toBe(false);
  });

  it("rejects listByProduct filter keys and malformed identities (params closed single-key {productId})", () => {
    // 负例 invalid-dependencies-listbyproduct-params:客户端给过滤 = 契约
    // 错误,绝不静默空答
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.listByProduct",
      params: { productId: "booth:6584744", depKind: "shader" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "dependencies.listByProduct",
      params: { productId: "booth:6584744", name: "lil" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.listByProduct", params: { productId: "lil" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.listByProduct", params: { productId: "booth:lil" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "dependencies.listByProduct", params: {},
    })).toBe(false);
  });
});

describe("bdl-queries v0.2 gateway surface", () => {
  const base = { schemaVersion: 1, requestId: "r" } as const;

  it("accepts the five read-only queries within the frozen closed sets", () => {
    expect(isDesktopGatewayRequestV1({ ...base, method: "catalog.list", params: {} })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "catalog.list",
      params: { text: "uniform", availabilityStatus: "available", limit: 50, offset: 0 },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base,
      method: "catalog.list",
      params: { text: null, availabilityStatus: null },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.detail", params: { productId: "booth:1000001" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({ ...base, method: "catalog.status", params: {} })).toBe(true);
    expect(isDesktopGatewayRequestV1({ ...base, method: "warehouse.listEntries", params: {} })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.entryDetail", params: { warehouseItemId: "wh-1" },
    })).toBe(true);
  });

  it("rejects entity filters, bad enum values, out-of-range paging, and bad identities", () => {
    // 负例对齐 schemas/bdl-queries/v0.2/examples:实体过滤参数必被拒
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { entityType: "avatar" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { relationKind: "addon_for" },
    })).toBe(false);
    // 负例对齐:非稳定枚举的筛选值必被拒(原词透传不构成合法筛选项)
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { availabilityStatus: "InStock" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { limit: 0 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { limit: 201 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { offset: -1 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.list", params: { text: "" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.detail", params: { productId: "product-1" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "catalog.status", params: { extra: 1 },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.entryDetail", params: {},
    })).toBe(false);
  });
});

describe("bdl-commands v0.1 gateway surface", () => {
  const base = { schemaVersion: 1, requestId: "r" } as const;

  it("accepts the three warehouse write commands with commandId and closed mode sets", () => {
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.setArtifactMode",
      params: { warehouseItemId: "wh-entry-1", mode: "generate_vpm", commandId: "cmd-1" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.setArtifactMode",
      params: { warehouseItemId: "wh-entry-1", mode: null, commandId: "cmd-2" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.generateVpm",
      params: { warehouseItemId: "wh-entry-1", commandId: "cmd-3" },
    })).toBe(true);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.deleteOriginals",
      params: { warehouseItemId: "wh-entry-1", commandId: "cmd-4" },
    })).toBe(true);
  });

  it("rejects mode vocabulary escapes and missing command ids", () => {
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.setArtifactMode",
      params: { warehouseItemId: "wh-entry-1", mode: "unknown_mode", commandId: "cmd-5" },
    })).toBe(false);
    expect(isDesktopGatewayRequestV1({
      ...base, method: "warehouse.generateVpm",
      params: { warehouseItemId: "wh-entry-1" },
    })).toBe(false);
  });
});

describe("gateway guard covers every declared method (regression: silent guard gaps)", () => {
  // 回归锚(2026-09-09 发现):METHOD_KINDS 已登记而守卫 switch 缺 case 的
  // 方法会被 router 以 invalid_request 拒绝——v0.2/v0.3/W20/014 各批共有
  // 此缺口(setGlobalDefaultMode/import/十方法/import-copy),本表保证
  // 「声明即守卫」不再漂移。新方法入 METHOD_KINDS 时必须同批补本表正例。
  const base = { schemaVersion: 1, requestId: "r" } as const;
  const minimalValidParams: Readonly<Record<string, Record<string, unknown>>> = {
    "app.snapshot": {},
    "task.list": {},
    "task.get": { taskId: "task-1" },
    "task.requestCancellation": { taskId: "task-1", commandId: "cancel-1" },
    "environment.getSnapshot": {},
    "environment.verifyEditor": { path: "C:\\Editors\\2022.3.22f1\\Editor\\Unity.exe" },
    "task.startDemo": { commandId: "demo-1" },
    "production.startInspection": { materialRefId: "mat-1", commandId: "cmd-1" },
    "production.getInspection": { inspectionId: "ins-1" },
    "production.requestPlan": { inspectionId: "ins-1", commandId: "cmd-2", mode: "direct_unity_package" },
    "production.getPlan": { planId: "plan-1" },
    "production.confirmPlan": { planId: "plan-1", commandId: "cmd-3", observedRevision: 2, riskChoice: "continue" },
    "production.recover": { taskId: "task-1", commandId: "cmd-4", decision: "continue" },
    "production.getBuildRecord": { buildRecordId: "br-1" },
    "catalog.list": {},
    "catalog.detail": { productId: "booth:1234567" },
    "catalog.status": {},
    "warehouse.listEntries": {},
    "warehouse.entryDetail": { warehouseItemId: "wh-entry-1" },
    "downloads.listCompleted": {},
    "dependencies.lookup": { name: "lilToon" },
    "dependencies.listByProduct": { productId: "booth:6584744" },
    "project.environmentManagers": {},
    "project.listProjects": {},
    "project.inspectProject": { projectPath: "C:/proj" },
    "project.lockStatus": { projectPath: "C:/proj" },
    "download.retry": { taskId: "task-1", commandId: "cmd-5" },
    "warehouse.setArtifactMode": { warehouseItemId: "wh-entry-1", mode: null, commandId: "cmd-6" },
    "warehouse.generateVpm": { warehouseItemId: "wh-entry-1", commandId: "cmd-7" },
    "warehouse.deleteOriginals": { warehouseItemId: "wh-entry-1", commandId: "cmd-8" },
    "warehouse.setGlobalDefaultMode": { mode: "generate_vpm", commandId: "cmd-9" },
    "warehouse.import": { sourceFolders: ["C:/material"], commandId: "cmd-10" },
    "warehouse.importDownloads": { downloadIds: ["dl-1"], commandId: "cmd-11" },
    "recipe.save": { recipeDocument: { schemaVersion: "0.3" }, baseRevision: 0 },
    "recipe.get": { recipeId: "recipe-1" },
    "recipe.list": {},
    "recipe.resolve": { recipeId: "recipe-1" },
    "plan.approve": { planId: "plan-1" },
    "plan.get": { planId: "plan-1" },
    "plan.list": {},
    "job.execute": { planId: "plan-1" },
    "record.get": { buildId: "build-1" },
    "record.list": {},
    "project.import-copy": {
      phase: "plan",
      sourcePath: "C:/proj",
      targetParentDirectory: "C:/vua",
      targetProjectName: "copy",
    },
    "inspection.get": { inspectionId: "01982b5a-3f10-7c4e-9d2a-4b8e1f6a7c21" },
    "inspection.list": {},
    "release.openForHandoff": { buildId: "build-1" },
    "release.openForInspection": { buildId: "build-1" },
    "packages.listInstalled": { projectPath: "C:/proj" },
    "packages.listRepos": {},
    "packages.packageCatalog": { projectPath: "C:/proj", packageId: "com.anatawa12.avatar-optimizer" },
    "packages.previewRemove": { projectPath: "C:/proj", packageIds: ["com.a.b"] },
    "packages.applyRemove": { projectPath: "C:/proj", packageIds: ["com.a.b"], confirmedDigest: "fnv-1a-abc" },
    "packages.previewInstall": { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: null }] },
    "packages.applyInstall": {
      projectPath: "C:/proj",
      packages: [{ packageId: "com.a.b", version: null }],
      confirmedDigest: "fnv-1a-abc",
    },
  };

  it("admits a minimal well-formed request for every method in the kind table", () => {
    for (const [method, params] of Object.entries(minimalValidParams)) {
      expect(isDesktopGatewayRequestV1({ ...base, method, params }), method).toBe(true);
    }
  });

  it("environment.verifyEditor: params closed single-key {path} minLength 1 (021 ruling 3)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-40",
      method: "environment.verifyEditor" as const,
      params: { path: "C:\\Editors\\2022.3.22f1" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串/投机字段/错型:一律拒绝(形状违反 ≠ 验证拒绝)
    expect(isDesktopGatewayRequestV1({ ...request, params: {} })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { path: "" } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { path: "C:\\x", follow: true } }),
    ).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { path: 7 } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: "C:\\x" })).toBe(false);
  });

  it("packages.listInstalled: params closed single-key {projectPath} minLength 1 (024 P1 freeze; envelope guard matches schema additionalProperties:false)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-41",
      method: "packages.listInstalled" as const,
      params: { projectPath: "C:\\VRChat\\Projects" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串/投机字段/错型/多键:一律拒绝(形状违反 ≠ 服务端 typed 拒绝)
    expect(isDesktopGatewayRequestV1({ ...request, params: {} })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "" } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/x", projectId: "p-1" } }),
    ).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: 7 } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { path: "C:/x" } })).toBe(false);
  });

  it("release.openForInspection: params closed single-key {buildId} minLength 1 (release-handoff v0.2 U19 inspection entry; envelope guard matches schema additionalProperties:false)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-42",
      method: "release.openForInspection" as const,
      params: { buildId: "019513e7-7a2b-7cd1-9f3a-4d8e21b90c99" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串/投机键(工程身份权威在 build-record 面)/错型:一律拒绝
    // (形状违反 ≠ 服务端 typed 拒绝)
    expect(isDesktopGatewayRequestV1({ ...request, params: {} })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { buildId: "" } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { buildId: "b-1", projectPath: "C:/x" } }),
    ).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { buildId: 7 } })).toBe(false);
  });

  it("recipe.exportProjectDraft: params closed single-key {projectPath} minLength 1 (029 B-face freeze, recipe-export v0.1; envelope guard matches schema additionalProperties:false; the entry is limited to the registered project set - no arbitrary path face)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-44",
      method: "recipe.exportProjectDraft" as const,
      params: { projectPath: "C:\\VRChat\\Projects\\Demo" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串/投机字段/错型:一律拒绝(形状违反 ≠ 服务端 typed 拒绝;
    // 未注册路径由 Provider 复用 vua.project.project_not_found,信封只钉键形)
    expect(isDesktopGatewayRequestV1({ ...request, params: {} })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "" } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/x", recipeId: "r-1" } }),
    ).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: 7 } })).toBe(false);
  });

  it("packages.listRepos: params empty closed set — any key rejected (025 P2 freeze; global configuration face)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-42",
      method: "packages.listRepos" as const,
      params: {},
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 全局配置面:任何参数键(含投机 projectPath)都是词表外形状违反,不是默认
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { foo: 1 } })).toBe(false);
  });

  it("packages.packageCatalog: two-key closed params {projectPath, packageId} minLength 1 (025 P2 freeze; envelope guard matches schema additionalProperties:false)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-43",
      method: "packages.packageCatalog" as const,
      params: { projectPath: "C:\\VRChat\\Projects", packageId: "com.anatawa12.avatar-optimizer" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串/投机键(includePrerelease 词面外零 wire 开关)/多键:一律拒绝
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { packageId: "com.a.b" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "", packageId: "com.a.b" } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packageId: "com.a.b", includePrerelease: true },
      }),
    ).toBe(false);
  });

  it("packages.previewRemove: two-key closed params, packageIds non-empty unique closed list, NO digest slot (026 A1 freeze; digest is the preview's product — carrying it is a shape violation)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-44",
      method: "packages.previewRemove" as const,
      params: { projectPath: "C:\VRChat\Projects", packageIds: ["com.a.b", "com.c.d"] },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空串路径/空列(词面 minItems 1)/重复项(uniqueItems)/词外键/投机的
    // digest 位(preview 参数无 digest——携即形状违反):一律拒绝
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "", packageIds: ["com.a.b"] } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: [] } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: ["com.a.b", "com.a.b"] } }),
    ).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: [""] } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packageIds: ["com.a.b"], confirmedDigest: "fnv-1a-abc" },
      }),
    ).toBe(false);
  });

  it("packages.applyRemove: three-key closed params incl confirmedDigest, no commandId param slot (026 A1 freeze; Kernel generates the commandId per the import-copy precedent)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-45",
      method: "packages.applyRemove" as const,
      params: { projectPath: "C:\VRChat\Projects", packageIds: ["com.a.b"], confirmedDigest: "fnv-1a-abc" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺 confirmedDigest/空 digest/空列/重复项/投机 commandId 位:一律拒绝
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: ["com.a.b"] } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: ["com.a.b"], confirmedDigest: "" } }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packageIds: [], confirmedDigest: "d" } }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packageIds: ["com.a.b", "com.a.b"], confirmedDigest: "d" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packageIds: ["com.a.b"], confirmedDigest: "d", commandId: "cmd-1" },
      }),
    ).toBe(false);
  });

  it("packages.previewInstall: two-key closed params, request rows {packageId, version string|null} with cross-row id uniqueness, NO digest slot (026 A2 freeze; version null = resolver-picked latest stable; same id twice even with differing versions = word-face violation pinned by seenIds, matching the A2 guard narrowing)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-46",
      method: "packages.previewInstall" as const,
      params: {
        projectPath: "C:/proj",
        packages: [{ packageId: "com.a.b", version: null }, { packageId: "com.c.d", version: "3.1.4" }],
      },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺键/空路径/空列/词外键/投机的 digest 位(preview 参数无 digest——
    // 携即形状违反):一律拒绝
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "", packages: [{ packageId: "com.a.b", version: null }] } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, params: { projectPath: "C:/proj", packages: [] } })).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: null, displayName: "A" }] },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: null }], confirmedDigest: "d" },
      }),
    ).toBe(false);
    // 请求行缺 version 键 = 形状违反(version 必填可空,null 是显式语义);
    // 数字型 version = string|null 闭集违反
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b" }] },
      } as unknown as Parameters<typeof isDesktopGatewayRequestV1>[0]),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: 1 }] },
      } as unknown as Parameters<typeof isDesktopGatewayRequestV1>[0]),
    ).toBe(false);
    // 完全重复行(uniqueItems 语义)与同 id 异版本(行间 id 唯一,seenIds
    // 钉死——Schema uniqueItems 表达不了跨行 id 比较):一律拒绝
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: {
          projectPath: "C:/proj",
          packages: [{ packageId: "com.a.b", version: null }, { packageId: "com.a.b", version: null }],
        },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: {
          projectPath: "C:/proj",
          packages: [{ packageId: "com.a.b", version: null }, { packageId: "com.a.b", version: "3.1.4" }],
        },
      }),
    ).toBe(false);
  });

  it("packages.applyInstall: three-key closed params incl confirmedDigest, request rows share the preview closed-column rule, no commandId param slot (026 A2 freeze; Kernel generates the commandId per the import-copy precedent)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-47",
      method: "packages.applyInstall" as const,
      params: {
        projectPath: "C:/proj",
        packages: [{ packageId: "com.a.b", version: null }],
        confirmedDigest: "fnv-1a-abc",
      },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺 confirmedDigest/空 digest/空列/同 id 异版本/投机 commandId 位:
    // 一律拒绝
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: null }] },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [{ packageId: "com.a.b", version: null }], confirmedDigest: "" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { projectPath: "C:/proj", packages: [], confirmedDigest: "d" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: {
          projectPath: "C:/proj",
          packages: [{ packageId: "com.a.b", version: null }, { packageId: "com.a.b", version: "3.1.4" }],
          confirmedDigest: "d",
        },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: {
          projectPath: "C:/proj",
          packages: [{ packageId: "com.a.b", version: null }],
          confirmedDigest: "d",
          commandId: "cmd-2",
        },
      }),
    ).toBe(false);
  });

  it("packages.registerLocalPackage: single-key closed params {packageRoot} non-empty, NO projectPath NO digest slot no commandId param slot (026 A3 freeze; the family's only face without a preview arm - the user's explicit submission IS the confirmation; registration never touches a project and never mutates VCC/ALCOM settings)", () => {
    const request = {
      schemaVersion: 1 as const,
      requestId: "request-53",
      method: "packages.registerLocalPackage" as const,
      params: { packageRoot: "C:/local/com.a.b-1.0.0" },
    };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    // 缺 packageRoot/空串(空串 = 无根目录,词面 minLength 1)/发明
    // projectPath 位(注册不触项目)/携 digest 位(本面无 preview 可漂移,
    // 携即形状违反——负例 invalid-register-carries-digest 同形)/投机
    // commandId 位:一律拒绝
    expect(
      isDesktopGatewayRequestV1({ ...request, params: {} }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({ ...request, params: { packageRoot: "" } }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { packageRoot: "C:/local/com.a.b-1.0.0", projectPath: "C:/proj" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { packageRoot: "C:/local/com.a.b-1.0.0", confirmedDigest: "d" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...request,
        params: { packageRoot: "C:/local/com.a.b-1.0.0", commandId: "cmd-9" },
      }),
    ).toBe(false);
  });

  it("packages.addRemoteRepo / addLocalRepo / removeRepo: exact keyset closed params non-empty, NO projectPath NO digest slot no commandId param slot (026 A4 freeze; the face breaks the preview/apply pair per the A3 law - a preview would be a second network round-trip pretending to be a safer first hop and no pre-existing state digest exists to bind, so the user's explicit submission IS the confirmation; the subscription face writes the backend's isolated environment only)", () => {
    const addRemote = {
      schemaVersion: 1 as const,
      requestId: "request-54",
      method: "packages.addRemoteRepo" as const,
      params: { url: "https://vpm.example/index.json", name: "Example Repo" },
    };
    const addLocal = {
      schemaVersion: 1 as const,
      requestId: "request-55",
      method: "packages.addLocalRepo" as const,
      params: { path: "C:/Repos/local-curations", name: "Local Curations" },
    };
    const remove = {
      schemaVersion: 1 as const,
      requestId: "request-56",
      method: "packages.removeRepo" as const,
      params: { repoId: "repo-example" },
    };
    expect(isDesktopGatewayRequestV1(addRemote)).toBe(true);
    expect(isDesktopGatewayRequestV1(addLocal)).toBe(true);
    expect(isDesktopGatewayRequestV1(remove)).toBe(true);
    // 缺键/空串(词面 minLength 1)一律拒绝
    expect(isDesktopGatewayRequestV1({ ...addRemote, params: { name: "Example Repo" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...addRemote, params: { url: "", name: "Example Repo" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...addLocal, params: { path: "C:/Repos" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...addLocal, params: { path: "C:/Repos", name: "" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...remove, params: {} })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...remove, params: { repoId: "" } })).toBe(false);
    // 发明 projectPath 位(订阅面不触项目)/携 digest 位(本面无 preview 可
    // 漂移,携即形状违反——负例 invalid-add-remote-carries-digest 同形)/
    // 投机 commandId 位/多余键:一律拒绝
    expect(
      isDesktopGatewayRequestV1({
        ...addRemote,
        params: { url: "https://vpm.example/index.json", name: "Example Repo", projectPath: "C:/proj" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...addRemote,
        params: { url: "https://vpm.example/index.json", name: "Example Repo", confirmedDigest: "d" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...remove,
        params: { repoId: "repo-example", confirmedDigest: "d" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...addLocal,
        params: { path: "C:/Repos", name: "Local Curations", commandId: "cmd-9" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...addLocal,
        params: { path: "C:/Repos", name: "Local Curations", extra: 1 },
      }),
    ).toBe(false);
  });

  it("packages.createProject: three-key closed params {parent,name,template} with template REQUIRED-nullable, NO projectPath NO digest slot no commandId param slot (026 A5 freeze; single-stage task rooted in the port - no create-preview counterpart exists, a brand-new directory has no pre-existing state to diff and no digest to bind, so the user's explicit form submission IS the confirmation; creation addresses no registered project; null template = the backend's default resolution, empty string = shape violation)", () => {
    const create = {
      schemaVersion: 1 as const,
      requestId: "request-57",
      method: "packages.createProject" as const,
      params: { parent: "C:/Users/me/VRC projects", name: "New World", template: null },
    };
    const createWithTemplate = {
      schemaVersion: 1 as const,
      requestId: "request-58",
      method: "packages.createProject" as const,
      params: { parent: "C:/Users/me/VRC projects", name: "New Avatar", template: "Avatar" },
    };
    expect(isDesktopGatewayRequestV1(create)).toBe(true);
    expect(isDesktopGatewayRequestV1(createWithTemplate)).toBe(true);
    // 缺键/空串(词面 minLength 1)一律拒绝;template REQUIRED-nullable:
    // 键必须在位(null = 后端默认解析),空串/非串 = 违例
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "C:/p", name: "New World" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { name: "New World", template: null } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "C:/p", template: null } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "", name: "New World", template: null } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "C:/p", name: "", template: null } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "C:/p", name: "New World", template: "" } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...create, params: { parent: "C:/p", name: "New World", template: 3 } })).toBe(false);
    // 发明 projectPath 位(创建不寻址任何在册项目,013 复用不适用)/携
    // digest 位(本面无 preview 可漂移,携即形状违反——负例钉死)/投机
    // commandId 位/多余键:一律拒绝
    expect(
      isDesktopGatewayRequestV1({
        ...create,
        params: { parent: "C:/p", name: "New World", template: null, projectPath: "C:/proj" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...create,
        params: { parent: "C:/p", name: "New World", template: null, confirmedDigest: "fnv-1a-abc" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...create,
        params: { parent: "C:/p", name: "New World", template: null, commandId: "cmd-1" },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        ...create,
        params: { parent: "C:/p", name: "New World", template: null, extra: 1 },
      }),
    ).toBe(false);
  });
});
