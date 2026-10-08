import type {
  DependencyKindV05,
  DependencyMatchV05,
  DependencyObservationV05,
  DependencyProductStatusV05,
  DependencyResolutionEvidenceV05,
} from "@vua/contracts";
import type { DesktopGatewayRequestV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";

export type {
  DependenciesListByProductResultV05,
  DependenciesLookupResultV05,
  DependencyAdvisoryConfidenceV05,
  DependencyInstallAdvisoryV05,
  DependencyInstallSourceV05,
  DependencyKindV05,
  DependencyMatchV05,
  DependencyObservationV05,
  DependencyProductStatusV05,
  DependencyResolutionEvidenceV05,
  DependencyResolutionV05,
  DependencySourceSpanV05,
  DependencyExtractionMethodV05,
} from "@vua/contracts";

/**
 * 依赖反查/观察列窄端口(bdl-queries v0.6 信封,保持 v0.5 依赖词面;030
 * §5.7 案 A,数据席第 168 批 FROZEN):dependencies.lookup(建议面)与
 * dependencies.listByProduct(未过滤观察面)两方法只读——「线索非结论」
 * 律的桌面落点:lookup 列匹配观察,仅人工确认消解可携 resolvedProductId,
 * 过建议门才携 advisory;listByProduct 列全部观察含 confirmed:false。
 * N5 的可选显示/反查消费这些只读面,不自动安装;缺席臂沿用能力缺席先例(recipe-export 环 4
 * 同构),empty/fixture 装配恒答缺席,绝不伪造线索/建议。
 *
 * - 词面骑 BDL v0.2 冻结闭集,投影按 client 纪律逐字段收窄:闭集词表外
 *   取值、身份形态不齐(非 booth:<数字>)、必需键收不齐 = 信封不可解释
 *   → honest absent(不渲染半可信行,两面同律整份拒绝——观察面是无过滤
 *   面,静默丢行会掩盖线索,故不取 catalog 列表丢弃先例);
 * - 缺席语义:实现域未接线(核心接线批前 provider 答 unknown_method)、
 *   类型化能力缺席(category "unavailable"——mock/真实 provider-host 缺席
 *   分支同三元)、传输不可达、信封不可解释 → kind "absent"(控制不渲染,
 *   绝不把能力缺席渲染成失败页);应用错误按稳定码收窄白名单 messageKey
 *   (bdl-queries 族骑既有 errors.catalog.* 行,零新错误词面),词表外码
 *   回落 fallback,不猜测具体原因;
 * - product_not_found 是事实形态(kind "not-found"),不是错误文案(W12/W17
 *   判例);lookup 空集是 results(total:0 = 无匹配名义,呈现面绝不渲染成
 *   「不存在该依赖」——协议明记,消费方不得越线);
 * - 路径零出现(house 律):投影面不持有任何 storedPath/relativePath 形键。
 */

/** 建议面视图(lookup) */
export type DependenciesLookupView =
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly messageKey: DependenciesErrorKey }
  | {
      readonly kind: "results";
      /** 匹配观察总数(分页前);total:0 = 无匹配名义,不是「无此依赖」 */
      readonly total: number;
      readonly matches: readonly DependencyMatchV05[];
    };

/** 观察面视图(listByProduct):productStatus missing = 墓碑诚实面,观察列
 *  照常可读 */
export type DependenciesObservationsView =
  | { readonly kind: "absent" }
  | { readonly kind: "error"; readonly messageKey: DependenciesErrorKey }
  | { readonly kind: "not-found" }
  | {
      readonly kind: "observations";
      readonly productId: string;
      readonly productStatus: DependencyProductStatusV05;
      readonly observations: readonly DependencyObservationV05[];
    };

/** W17 透传呈现:冻结应用面码 → 白名单 messageKey(bdl-queries 族同库同
 *  源,骑既有 errors.catalog.* 四语行,零新错误词面);词表外码回落
 *  fallback,不猜测。category "unavailable" 的类型化缺席不入此表——缺席
 *  走 absent 臂(控制不渲染),绝不渲染成失败页。product_not_found 亦不
 *  入此表——未命中是独立事实形态(kind "not-found") */
export type DependenciesErrorKey =
  | "errors.catalog.invalidParams"
  | "errors.catalog.storeFailed"
  | "errors.catalog.fallback";

const APPLICATION_ERROR_KEYS: Record<string, DependenciesErrorKey> = {
  "vua.catalog.invalid_params": "errors.catalog.invalidParams",
  "vua.catalog.store_failed": "errors.catalog.storeFailed",
};

/** BDL v0.2 冻结闭集词表(投影收窄权威;与冻结 Schema 枚举逐字对表) */
const DEPENDENCY_KINDS: readonly DependencyKindV05[] = [
  "shader",
  "tool_package",
  "avatar_base",
  "other",
];
const SOURCE_SPANS = [
  "body",
  "subproduct_name",
  "image",
  "title",
  "description_link",
] as const;
const EXTRACTION_METHODS = [
  "explicit_heading",
  "bullet",
  "one_line",
  "prose",
  "title",
  "link",
] as const;
const AVAILABILITY_STATUSES = ["available", "unavailable", "unknown"] as const;
const INSTALL_SOURCES = ["vpm", "booth_page", "external_page", "unknown"] as const;
const ADVISORY_CONFIDENCES = ["strong", "weak"] as const;
const PRODUCT_STATUSES = ["complete", "missing"] as const;

/** v0.5 身份命名空间:与 Kernel 守卫同形,形态不齐的行/请求如实拒绝 */
const BOOTH_PRODUCT_ID_PATTERN = /^booth:[0-9]+$/;

/** lookup 三方法族请求窄化:wildcard method 字面量收窄出联合 */
type DependenciesGatewayRequest = Extract<
  DesktopGatewayRequestV1,
  { readonly method: "dependencies.lookup" | "dependencies.listByProduct" }
>;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 词表收窄:词表内取值原样返回,否则 null(零猜测) */
function word<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  return typeof value === "string" && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** bdl-queries 三键信封解包:v0.6 族常量 + operation 精确命中;词表外信封
 *  = null(调用方按缺席处理,绝不平铺猜测) */
function bdlQueryResultV06(value: unknown, operation: string): Record<string, unknown> | null {
  const envelope = asRecord(value);
  if (envelope === null) return null;
  if (envelope.schemaVersion !== "0.6" || envelope.operation !== operation) return null;
  return asRecord(envelope.result);
}

function narrowResolutionEvidence(value: unknown): DependencyResolutionEvidenceV05 | null {
  const record = asRecord(value);
  if (record === null) return null;
  const linkText = asString(record.linkText);
  const linkUrl = asString(record.linkUrl);
  const span = word(record.span, SOURCE_SPANS);
  if (linkText === null || linkUrl === null || span === null) return null;
  // note 键必须在位(null = 诚实无备注);缺席 = 键形不齐,不猜测
  if (record.note === undefined) return null;
  const note = record.note === null ? null : asString(record.note);
  if (record.note !== null && note === null) return null;
  return { linkText, linkUrl, span, note };
}

function narrowResolution(value: unknown): {
  productId: string;
  confirmed: boolean;
  evidence: readonly DependencyResolutionEvidenceV05[];
} | null {
  const record = asRecord(value);
  if (record === null) return null;
  const productId = asString(record.productId);
  if (productId === null || !BOOTH_PRODUCT_ID_PATTERN.test(productId)) return null;
  if (typeof record.confirmed !== "boolean") return null;
  // store 层硬律(resolution 在场 ⇒ evidence 非空)镜像为键形收窄
  if (!Array.isArray(record.evidence) || record.evidence.length < 1) return null;
  const evidence: DependencyResolutionEvidenceV05[] = [];
  for (const row of record.evidence) {
    const narrowed = narrowResolutionEvidence(row);
    if (narrowed === null) return null;
    evidence.push(narrowed);
  }
  return { productId, confirmed: record.confirmed, evidence };
}

/** 观察行收窄(listByProduct 线索面):九键闭集,任一键收不齐 = 整份不可
 *  解释(调用方拒绝整份,不渲染半可信观察、不静默丢线索) */
export function narrowDependencyObservation(value: unknown): DependencyObservationV05 | null {
  const record = asRecord(value);
  if (record === null) return null;
  const depKind = word(record.depKind, DEPENDENCY_KINDS);
  const depName = asString(record.depName);
  const rawQuote = asString(record.rawQuote);
  const sourceSpan = word(record.sourceSpan, SOURCE_SPANS);
  const extractionMethod = word(record.extractionMethod, EXTRACTION_METHODS);
  const extractedBy = asString(record.extractedBy);
  const observedAt = asString(record.observedAt);
  if (
    depKind === null ||
    depName === null ||
    rawQuote === null ||
    sourceSpan === null ||
    extractionMethod === null ||
    extractedBy === null ||
    observedAt === null
  ) {
    return null;
  }
  // versionHint 键必须在位(null = 页面未钉版本,诚实缺席)
  if (record.versionHint === undefined) return null;
  const versionHint = record.versionHint === null ? null : asString(record.versionHint);
  if (record.versionHint !== null && versionHint === null) return null;
  // resolution 键必须在位(null = 无可消解链接线索)
  if (record.resolution === undefined) return null;
  const resolution = record.resolution === null ? null : narrowResolution(record.resolution);
  if (record.resolution !== null && resolution === null) return null;
  return {
    depKind,
    depName,
    versionHint,
    rawQuote,
    sourceSpan,
    extractionMethod,
    extractedBy,
    observedAt,
    resolution,
  };
}

/** 建议行收窄(lookup):advisory 键必须在位(null = 不出建议;非 null 携
 *  installSource/confidence 两闭集键) */
export function narrowDependencyMatch(value: unknown): DependencyMatchV05 | null {
  const record = asRecord(value);
  if (record === null) return null;
  const productId = asString(record.productId);
  if (productId === null || !BOOTH_PRODUCT_ID_PATTERN.test(productId)) return null;
  const availabilityStatus = word(record.availabilityStatus, AVAILABILITY_STATUSES);
  const depKind = word(record.depKind, DEPENDENCY_KINDS);
  const depName = asString(record.depName);
  const rawQuote = asString(record.rawQuote);
  const sourceSpan = word(record.sourceSpan, SOURCE_SPANS);
  const extractionMethod = word(record.extractionMethod, EXTRACTION_METHODS);
  if (
    availabilityStatus === null ||
    depKind === null ||
    depName === null ||
    rawQuote === null ||
    sourceSpan === null ||
    extractionMethod === null
  ) {
    return null;
  }
  // productTitle/availabilityRaw/versionHint/resolvedProductId REQUIRED-
  // nullable 四键:键必须在位,null = 诚实缺席;非空串合法;其余类型 = 键形
  // 违例 → 整行不可解释(与观察行同律,不静默折成 null)
  if (
    record.productTitle === undefined ||
    !isHonestNullableString(record.productTitle) ||
    record.availabilityRaw === undefined ||
    !isHonestNullableString(record.availabilityRaw) ||
    record.versionHint === undefined ||
    !isHonestNullableString(record.versionHint)
  ) {
    return null;
  }
  const productTitle = record.productTitle as string | null;
  const availabilityRaw = record.availabilityRaw as string | null;
  const versionHint = record.versionHint as string | null;
  if (record.resolvedProductId === undefined) return null;
  const resolvedProductId =
    record.resolvedProductId === null ? null : asString(record.resolvedProductId);
  if (resolvedProductId !== null && !BOOTH_PRODUCT_ID_PATTERN.test(resolvedProductId)) {
    return null;
  }
  if (resolvedProductId === null && record.resolvedProductId !== null) {
    return null;
  }
  // advisory REQUIRED-nullable:非 null 携两闭集键
  if (record.advisory === undefined) return null;
  let advisory: DependencyMatchV05["advisory"] = null;
  if (record.advisory !== null) {
    const advisoryRecord = asRecord(record.advisory);
    if (advisoryRecord === null) return null;
    const installSource = word(advisoryRecord.installSource, INSTALL_SOURCES);
    const confidence = word(advisoryRecord.confidence, ADVISORY_CONFIDENCES);
    if (installSource === null || confidence === null) return null;
    advisory = { installSource, confidence };
  }
  return {
    productId,
    productTitle,
    availabilityRaw,
    availabilityStatus,
    depKind,
    depName,
    versionHint,
    rawQuote,
    sourceSpan,
    extractionMethod,
    resolvedProductId,
    advisory,
  };
}

/** REQUIRED-nullable 串键合法性:null = 诚实缺席,非空串合法;其余 = 键形
 *  违例(键缺席由调用处以 undefined 判定) */
function isHonestNullableString(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length > 0);
}

/** 应用错误 → 缺席或白名单 messageKey:类型化能力缺席(category
 *  "unavailable",mock/真实 provider-host 缺席分支同三元)与实现域未接线
 *  (unknown_method)= absent 臂;其余按白名单收窄,词表外码回落 fallback。
 *  product_not_found 由调用处先判(事实形态,不入本分类) */
function classifyApplicationError(error: {
  code: string;
  category: string;
}): { kind: "absent" } | { kind: "error"; messageKey: DependenciesErrorKey } {
  if (error.category === "unavailable" || error.code === "vua.provider.unknown_method") {
    return { kind: "absent" };
  }
  return {
    kind: "error",
    messageKey: APPLICATION_ERROR_KEYS[error.code] ?? "errors.catalog.fallback",
  };
}

/** 查询参数组装:缺席可选项绝不发送(键集闭集,词外键 = 形状违反) */
function lookupRequest(
  requestId: string,
  query: DependenciesLookupQuery,
): DependenciesGatewayRequest {
  return {
    schemaVersion: 1,
    requestId,
    method: "dependencies.lookup",
    params: {
      name: query.name,
      ...(query.depKind === undefined ? {} : { depKind: query.depKind }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
    },
  } as DependenciesGatewayRequest;
}

export interface DependenciesLookupQuery {
  /** 依赖名义原文(必填非空);匹配规则 v1 = 精确匹配,零模糊 */
  readonly name: string;
  /** 可选过滤骑 BDL v0.2 四值闭集;null/缺席 = 不过滤 */
  readonly depKind?: DependencyKindV05 | null;
  /** 1–200,默认 50(AMF 默认) */
  readonly limit?: number;
  /** ≥ 0,默认 0 */
  readonly offset?: number;
}

export interface DependenciesPort {
  /** 依赖名义反查(建议面):total:0 = 无匹配名义(诚实空集),「无此依
   *  赖」渲染为越线;缺席/失败不虚构建议 */
  lookup(query: DependenciesLookupQuery): Promise<DependenciesLookupView>;
  /** 单商品观察全列(未过滤线索面):tombstone 以 productStatus:'missing'
   *  如实出线;未知商品 = not-found 事实形态 */
  listByProduct(productId: string): Promise<DependenciesObservationsView>;
}

/** live 端口(经 Kernel 直达 provider):实现域未接线 = provider 类型化
 *  unknown_method → absent(诚实缺席,控制不渲染);传输异常 → absent;
 *  信封不可解释 → absent。三路缺席同臂,绝不伪造线索/建议 */
export function createLiveDependenciesPort(client: GatewayClient): DependenciesPort {
  return {
    async lookup(query) {
      let result: Awaited<ReturnType<GatewayClient["invoke"]>>;
      try {
        result = await client.invoke(lookupRequest(crypto.randomUUID(), query));
      } catch {
        return { kind: "absent" };
      }
      if (!result.ok) {
        // 类型化应用错误按缺席臂/白名单收窄;传输面拒绝 = 缺席臂
        if (result.error.kind === "application") {
          return classifyApplicationError(result.error.error);
        }
        return { kind: "absent" };
      }
      const body = bdlQueryResultV06(result.value, "dependencies.lookup");
      if (body === null || typeof body.total !== "number" || !Array.isArray(body.matches)) {
        return { kind: "absent" };
      }
      const matches: DependencyMatchV05[] = [];
      for (const row of body.matches) {
        const narrowed = narrowDependencyMatch(row);
        if (narrowed === null) return { kind: "absent" };
        matches.push(narrowed);
      }
      return { kind: "results", total: body.total, matches };
    },

    async listByProduct(productId) {
      // 形态不齐的身份不可能存在:诚实 not-found,不投递必败请求
      if (!BOOTH_PRODUCT_ID_PATTERN.test(productId)) {
        return { kind: "not-found" };
      }
      let result: Awaited<ReturnType<GatewayClient["invoke"]>>;
      try {
        result = await client.invoke({
          schemaVersion: 1,
          requestId: crypto.randomUUID(),
          method: "dependencies.listByProduct",
          params: { productId },
        } as DependenciesGatewayRequest);
      } catch {
        return { kind: "absent" };
      }
      if (!result.ok) {
        if (result.error.kind === "application") {
          // 未命中(含墓碑外的未知商品)是事实形态,不是错误文案(W12/W17)
          if (result.error.error.code === "vua.catalog.product_not_found") {
            return { kind: "not-found" };
          }
          return classifyApplicationError(result.error.error);
        }
        return { kind: "absent" };
      }
      const body = bdlQueryResultV06(result.value, "dependencies.listByProduct");
      const productStatus = body === null ? null : word(body.productStatus, PRODUCT_STATUSES);
      if (
        body === null ||
        productStatus === null ||
        !Array.isArray(body.observations) ||
        asString(body.productId) === null
      ) {
        return { kind: "absent" };
      }
      const observations: DependencyObservationV05[] = [];
      for (const row of body.observations) {
        const narrowed = narrowDependencyObservation(row);
        if (narrowed === null) return { kind: "absent" };
        observations.push(narrowed);
      }
      return {
        kind: "observations",
        productId: body.productId as string,
        productStatus,
        observations,
      };
    },
  };
}

/** 缺席臂(empty/fixture 同一诚实缺席):能力缺席 = 控制不渲染先例——
 *  不伪造线索、不伪造建议、不伪造观察列(recipe-export 环 4 同构) */
export function createUnavailableDependenciesPort(): DependenciesPort {
  return {
    lookup: async () => ({ kind: "absent" }),
    listByProduct: async () => ({ kind: "absent" }),
  };
}
