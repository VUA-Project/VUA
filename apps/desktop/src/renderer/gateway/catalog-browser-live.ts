function cachedImageUrl(url: string): string {
  return url.startsWith("https://booth.pximg.net/")
    ? `vua-img://${encodeURIComponent(url)}`
    : url;
}
import type { DesktopGatewayRequestV1 } from "@vua/contracts";
import type { CatalogStatus } from "./catalog.ts";
import type {
  CatalogAvailabilityStatus,
  CatalogBrowserPort,
  CatalogBrowserQuery,
  CatalogDetailView,
  CatalogErrorKey,
  CatalogListView,
  CatalogProductDetail,
  CatalogProductSummary,
  CatalogSubproduct,
} from "./catalog-browser-port.ts";
import type { CatalogPrice } from "./refs.ts";
import type { GatewayClient, GatewayResult } from "./gateway-client.ts";
import type { CapabilityReport } from "./types.ts";

/**
 * F4-5 live 云端目录轨端口:catalog.list / catalog.detail / catalog.status
 * (bdl-queries v0.3 冻结读取面)经 typed client → Kernel 路由 → AMF/BDL
 * 真实链路,投影为目录域类型;无宿主退路保持 empty-gateway 的诚实
 * not-connected(catalog-browser-instance 装配)。
 *
 * - 投影纪律(client 纪律,同 live-acquire-port):wire 值按字段存在性收窄;
 *   派生枚举词表外取值、身份形态不齐(非 booth:<数字>)、收不齐必需字段
 *   的条目如实丢弃,不渲染半可信条目;可空信息字段按 null 诚实呈现;
 * - availability 双字段:raw = 观测原词证据(永不归一化,只在详情展示),
 *   status = AMF 派生稳定枚举(徽标与筛选唯一消费);域徽标词表的
 *   deleted 墓碑态不来自 live——墓碑不进 v0.3 目录面;
 * - 诚实语义要点:catalog 服务面已就绪而 BDL 未落观测数据时,list 如实
 *   回空集、status 回 health unknown——空态即终态,不谎报 not-connected;
 * - 断连语义:list/detail 失败回落 not-connected,status 失败回落
 *   health unknown,不向上抛错(目录轨失败不阻断应用启动);
 * - 订阅:暂无 catalog 变更事件词表——列表新鲜度由页面动作驱动(重复
 *   进入页面重取),G13 写路径切片再引事件;
 * - capability:catalog.status 可达即 ready;探测不预读全量列表。
 */

const notConnectedListView: CatalogListView = { schemaVersion: 1, kind: "not-connected" };

const AVAILABILITY_STATUSES: readonly CatalogAvailabilityStatus[] = [
  "available",
  "unavailable",
  "unknown",
];

/** v0.3 wire 健康词表(域五态的子集;stale/corrupted 为渲染层预留态) */
const WIRE_HEALTHS = ["unknown", "ok", "incompatible"] as const;

/** v0.3 身份命名空间:与 Kernel 守卫同形,形态不齐的条目/请求如实拒绝 */
const BOOTH_PRODUCT_ID_PATTERN = /^booth:[0-9]+$/;

/** catalog 三方法的请求窄化:wildcard method 字面量收窄出联合 */
type CatalogGatewayRequest = Extract<
  DesktopGatewayRequestV1,
  { readonly method: "catalog.list" | "catalog.detail" | "catalog.status" }
>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 词表收窄:词表内取值原样返回,否则 null */
function word<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  return typeof value === "string" && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * bdl-queries 三键信封解包(BOARD #36 缺陷②同类修复批,2026-09-18):
 * live wire 对 catalog.list / catalog.detail / catalog.status 应答
 * {schemaVersion "0.6", operation, result 本体}(provider-host
 * bdl_query_success),此前平铺读 value.{total,entries}/value.product/
 * value.{health,revision} 恒 undefined → 目录页真机恒 not-connected
 * (引擎健康,#22 live/fixture 形状分裂)。词表外信封 = null(调用方按
 * 未接入处理)。
 */
function bdlQueryResult(value: unknown, operation: string): Record<string, unknown> | null {
  const envelope = asRecord(value);
  if (envelope === null) return null;
  // bdl-queries 家族信封已随 v0.5 依赖批升版(v0.4→v0.5 只升共享信封常量,
  // 六方法词面不变);此处钉死旧版会让一切成功应答被判形态不齐而回落
  // not-connected——真机首验(2026-10-02)抓出的存量缺陷
  if (envelope.schemaVersion !== "0.6" || envelope.operation !== operation) return null;
  return asRecord(envelope.result);
}

/** invoke 收窄:catalog 三方法的回执值按 unknown 投影,错误通道原样透传 */
async function invokeCatalog(
  client: GatewayClient,
  request: CatalogGatewayRequest,
): Promise<GatewayResult<unknown>> {
  return client.invoke(request);
}

/** 查询闭集 → wire 参数:entityType/relationKind 退役保留位绝不发送 */
function listParams(query: CatalogBrowserQuery): CatalogListParams {
  const params: CatalogListParams = {};
  const text = query.text?.trim();
  if (text !== undefined && text.length > 0) params.text = text;
  if (query.availabilityStatus !== undefined) params.availabilityStatus = query.availabilityStatus;
  if (query.libraryType !== undefined) params.libraryType = query.libraryType;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.offset !== undefined) params.offset = query.offset;
  return params;
}

interface CatalogListParams {
  text?: string;
  availabilityStatus?: CatalogAvailabilityStatus;
  libraryType?: import("./catalog-browser-port.ts").CatalogLibraryType;
  limit?: number;
  offset?: number;
}

function projectPrice(value: unknown): CatalogPrice | null {
  const record = asRecord(value);
  if (record === null) return null;
  const amount = asString(record.amount);
  const currency = asString(record.currency);
  const high = asString(record.high);
  return amount !== null && currency !== null ? { amount, currency, high } : null;
}

function projectStringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/** availabilityStatus 是条目的必需闭集字段:词表外整条丢弃(半可信) */
function projectAvailabilityStatus(value: unknown): CatalogAvailabilityStatus | null {
  return word(value, AVAILABILITY_STATUSES);
}

function projectSummary(value: unknown): CatalogProductSummary | null {
  const record = asRecord(value);
  if (record === null) return null;
  const productId = asString(record.productId);
  if (productId === null || !BOOTH_PRODUCT_ID_PATTERN.test(productId)) return null;
  const availabilityStatus = projectAvailabilityStatus(record.availabilityStatus);
  if (availabilityStatus === null) return null;
  const imageUrls = projectStringArray(record.imageUrls);
  const libraryType =
    record.libraryType === "bought" || record.libraryType === "gifts" || record.libraryType === "free_downloads"
      ? record.libraryType
      : null;
  return {
    productId,
    title: asString(record.title),
    libraryType,
    importedArtifacts:
      typeof record.importedArtifacts === "number" && record.importedArtifacts >= 0
        ? record.importedArtifacts
        : 0,
    shopName: asString(record.shopName),
    price: projectPrice(record.price),
    // 协议保证 imageUrl = imageUrls[0] 或 null;缺失时按媒体首图收窄
    imageUrl: (asString(record.imageUrl) ?? imageUrls[0] ?? null) !== null
      ? cachedImageUrl(asString(record.imageUrl) ?? imageUrls[0] ?? "")
      : null,
    imageUrls,
    // 徽标词表以派生枚举填充(三值 ⊂ 四值);墓碑不来自 live
    availability: availabilityStatus,
    // 观测原词证据:原样保留,永不归一化
    availabilityRaw: asString(record.availabilityRaw),
    entityCount: typeof record.entityCount === "number" ? record.entityCount : 0,
    entityTypes: projectStringArray(record.entityTypes),
  };
}

function projectList(value: unknown): CatalogListView | null {
  const record = asRecord(value);
  // 协议面 {total, entries}:缺任一即非 conforming 响应,按未接入处理
  if (record === null || !Array.isArray(record.entries) || typeof record.total !== "number") {
    return null;
  }
  const items: CatalogProductSummary[] = [];
  for (const raw of record.entries) {
    // 词表外/形态不齐的条目如实丢弃,不渲染半可信条目
    const item = projectSummary(raw);
    if (item !== null) items.push(item);
  }
  return {
    schemaVersion: 1,
    kind: "results",
    items,
    total: record.total,
    // v0.3 wire 无词表:availability 词表即冻结闭集全集,实体/关系词表诚实空
    vocabulary: {
      availabilities: AVAILABILITY_STATUSES,
      entityTypes: [],
      relationKinds: [],
    },
  };
}

function projectSubproduct(value: unknown): CatalogSubproduct | null {
  const record = asRecord(value);
  if (record === null) return null;
  const availabilityStatus = projectAvailabilityStatus(record.availabilityStatus);
  if (availabilityStatus === null) return null;
  return {
    variationId: asString(record.variationId),
    name: asString(record.name),
    price: projectPrice(record.price),
    availabilityRaw: asString(record.availabilityRaw),
    availability: availabilityStatus,
  };
}

function projectDetail(value: unknown): CatalogProductDetail | null {
  const record = asRecord(value);
  if (record === null) return null;
  const productId = asString(record.productId);
  if (productId === null || !BOOTH_PRODUCT_ID_PATTERN.test(productId)) return null;
  const availabilityStatus = projectAvailabilityStatus(record.availabilityStatus);
  if (availabilityStatus === null) return null;
  const imageUrls = projectStringArray(record.imageUrls).map(cachedImageUrl);
  const videoUrls = projectStringArray(record.videoUrls);
  const subproducts: CatalogSubproduct[] = [];
  for (const raw of asArray(record.subproducts)) {
    // 形态不齐的变体按详情丢弃,不渲染半可信详情
    const subproduct = projectSubproduct(raw);
    if (subproduct === null) return null;
    subproducts.push(subproduct);
  }
  const shopName = asString(record.shopName);
  const shopUrl = asString(record.shopUrl);
  const libraryType =
    record.libraryType === "bought" || record.libraryType === "gifts" || record.libraryType === "free_downloads"
      ? record.libraryType
      : null;
  const variations = subproducts.map((sub) => ({
    variationId: sub.variationId,
    name: sub.name,
    price: sub.price,
    soldOut: sub.availability !== "available",
  }));
  return {
    productId,
    title: asString(record.title),
    libraryType,
    sourcePublishedAt: asString(record.sourcePublishedAt),
    variations,
    price: projectPrice(record.price),
    imageUrl: asString(record.imageUrl) ?? imageUrls[0] ?? null,
    availability: availabilityStatus,
    availabilityRaw: asString(record.availabilityRaw),
    // v0.3 无来源页与实体存储:诚实空槽(来源区/实体区/关系区随升版回归)
    sourceUrl: null,
    sourceLocale: null,
    description: asString(record.description),
    attribution:
      shopName !== null || shopUrl !== null
        ? { shopName, shopUrl, creatorName: null }
        : null,
    // 仅显式 Adult 徽标为真;非布尔按未见徽标处理,不猜测
    adult: record.adult === true,
    ageRestriction: asString(record.ageRestriction),
    sourceCategory: asString(record.sourceCategory),
    media: { imageUrls, videoUrls },
    terms: [],
    subproducts,
    entities: [],
  };
}

function projectStatus(value: unknown): CatalogStatus | null {
  const record = asRecord(value);
  if (record === null) return null;
  const health = word(record.health, WIRE_HEALTHS);
  const revision = asRecord(record.revision);
  if (health === null || revision === null) return null;
  const datasetRevision = asString(revision.datasetRevision);
  if (datasetRevision === null) return null;
  const catalogUpdatedSeq = revision.catalogUpdatedSeq;
  return {
    health,
    revision: {
      // 簿记计数器落地前恒 null:缺字段/null 同收,不猜测序号
      catalogUpdatedSeq:
        typeof catalogUpdatedSeq === "number" && Number.isSafeInteger(catalogUpdatedSeq)
          ? catalogUpdatedSeq
          : null,
      datasetRevision,
    },
  };
}

/** W17 透传呈现:冻结应用面码 → 白名单 messageKey;词表外码回落 fallback */
const APPLICATION_ERROR_KEYS: Record<string, CatalogErrorKey> = {
  "vua.catalog.invalid_params": "errors.catalog.invalidParams",
  "vua.catalog.unavailable": "errors.catalog.unavailable",
  "vua.catalog.store_failed": "errors.catalog.storeFailed",
};

/**
 * application 错误 → 透传 error 视图(W17):稳定码按白名单收窄,词表外码
 * 如实回落 fallback("目录操作未能完成"),不猜测具体原因。product_not_found
 * 由调用处特判为 not-found 形态(未命中是事实,不是错误文案)。
 */
function applicationErrorView(error: {
  kind: "unavailable" | "request_rejected" | "application";
  error?: { code: string };
}): CatalogErrorKey {
  if (
    error.kind === "application" &&
    error.error !== undefined &&
    APPLICATION_ERROR_KEYS[error.error.code] !== undefined
  ) {
    return APPLICATION_ERROR_KEYS[error.error.code]!;
  }
  return "errors.catalog.fallback";
}

export function createLiveCatalogBrowser(client: GatewayClient): CatalogBrowserPort {
  return {
    async list(query: CatalogBrowserQuery = {}): Promise<CatalogListView> {
      const result = await invokeCatalog(client, {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "catalog.list",
        params: listParams(query),
      });
      // W17:application 错误透传为 error 视图(键经 strings.errors 解析);
      // 传输面失败(服务未达)仍是 not-connected
      if (!result.ok) {
        return result.error.kind === "application"
          ? { schemaVersion: 1, kind: "error", messageKey: applicationErrorView(result.error) }
          : notConnectedListView;
      }
      // 形态不齐按未接入处理,不渲染半可信列表
      const resultBody = bdlQueryResult(result.value, "catalog.list");
      return resultBody !== null ? projectList(resultBody) ?? notConnectedListView : notConnectedListView;
    },

    async detail(productId): Promise<CatalogDetailView> {
      // 形态不齐的身份不可能存在:诚实 not-found,不投递必败请求
      if (!BOOTH_PRODUCT_ID_PATTERN.test(productId)) {
        return { schemaVersion: 1, kind: "not-found" };
      }
      const result = await invokeCatalog(client, {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "catalog.detail",
        params: { productId },
      });
      if (result.ok) {
        const resultBody = bdlQueryResult(result.value, "catalog.detail");
        const product = resultBody === null ? null : projectDetail(resultBody.product);
        return product !== null
          ? { schemaVersion: 1, kind: "detail", product }
          : { schemaVersion: 1, kind: "not-connected" };
      }
      // W12 对齐(provider 10325cd):detail 未命中(含墓碑)的应用面码为
      // vua.catalog.product_not_found,如实呈现 not-found,不误报断连
      if (
        result.error.kind === "application" &&
        result.error.error.code === "vua.catalog.product_not_found"
      ) {
        return { schemaVersion: 1, kind: "not-found" };
      }
      // W17:其余 application 错误透传为 error 视图;传输面失败仍是 not-connected
      return result.error.kind === "application"
        ? { schemaVersion: 1, kind: "error", messageKey: applicationErrorView(result.error) }
        : { schemaVersion: 1, kind: "not-connected" };
    },

    async status(): Promise<CatalogStatus> {
      const result = await invokeCatalog(client, {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "catalog.status",
        params: {},
      });
      // 状态失败 → health unknown(诚实缺省,不猜测 ok);不向上抛错
      if (!result.ok) return { health: "unknown" };
      const resultBody = bdlQueryResult(result.value, "catalog.status");
      return (resultBody !== null ? projectStatus(resultBody) : null) ?? { health: "unknown" };
    },

    async capability(): Promise<CapabilityReport> {
      // 服务面就绪即可用:BDL 未落数据时 status 也应答(ok/unknown),
      // 空目录不谎报 not-connected;探测失败才是目录轨不可达
      const result = await invokeCatalog(client, {
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "catalog.status",
        params: {},
      });
      return result.ok
        ? { state: "ready" }
        : { state: "unavailable", detailKey: "catalogMissing" };
    },
  };
}
