/**
 * 四类引用类型(G3,frontend-development-plan §G3 BDB 边界)。
 *
 * 身份纪律:
 * - CatalogProductRef 以 BDB 规范 product_id 为唯一身份;冗余携带 source /
 *   nativeId 时实例只能经 catalogProductRef() 校验创建,禁止随意拼对象;
 * - RecipeSourceRef 是 Recipe 中的来源引用:provider + 平台原生 productId;
 *   其 variant 是配方内自由文本变体选择描述,与 CatalogVariantId 类型不同,
 *   禁止隐式映射——未来只允许经过验证或用户确认的显式解析(parseCatalogVariantId);
 * - AssetRecord 的来源关联是候选,不证明拥有、兼容或本地可得;
 * - EntityRef 仅用于 Avatar 等语义实体(UUIDv7),不泛化为商品身份。
 *
 * 价格纪律:任何目录价格一律"字符串金额 + 币种",禁用 JS number
 * (二进制浮点不可表示货币;见 CatalogPrice)。
 *
 * 加性补强(G3 自审,对接中台 P0/P4 与 BDB L2 数据形态):
 * - CatalogProductRef.availability:墓碑/下架表达(v0.3 首测版只消费墓碑,
 *   实体重定向仍是能力门,不进类型);
 * - AssetRecord.sourceVerification:候选/未验证/已验证三档只记录事实,
 *   不携带"必须用户确认才能继续"的流程含义(交互决策留 G13 评审);
 * - AssetRecord.displayFallback:仅有商品引用(未解析出实体)时的卖家原文
 *   标题回退,识别失败的商品不得显示为空;
 * - CatalogPrice.estimate:汇率估算标注——存在即表示估算值而非牌价。
 */

declare const catalogVariantBrand: unique symbol;

/** BDB 规范变体身份:只能经 parseCatalogVariantId 显式解析产生 */
export type CatalogVariantId = string & { readonly [catalogVariantBrand]: true };

/** 商品可得性:deleted = 墓碑;缺省按 unknown 处理(不得猜测为 available) */
export type CatalogAvailability = "available" | "unavailable" | "unknown" | "deleted";

const AVAILABILITY_VALUES: readonly CatalogAvailability[] = [
  "available",
  "unavailable",
  "unknown",
  "deleted",
];

/** BDB 规范商品引用(不可变) */
export interface CatalogProductRef {
  /** 规范 product_id,形态 "<provider>:<nativeId>",如 "booth:3681787" */
  readonly productId: string;
  readonly source?: string;
  readonly nativeId?: string;
  readonly availability?: CatalogAvailability;
}

const PRODUCT_ID_PATTERN = /^[a-z0-9-]+:[^:\s]+$/;

/**
 * CatalogProductRef 唯一构造入口:校验 product_id 形态;如冗余携带
 * source / nativeId,必须与 product_id 解析结果一致,不一致即拒绝;
 * availability 来自不可信 wire 数据,逐项校验枚举值。
 */
export function catalogProductRef(input: {
  productId: string;
  source?: string;
  nativeId?: string;
  availability?: CatalogAvailability;
}): CatalogProductRef {
  const { productId, source, nativeId, availability } = input;
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new Error(`invalid canonical product_id: ${productId}`);
  }
  const [parsedSource, parsedNative] = productId.split(":", 2);
  if (source !== undefined && source !== parsedSource) {
    throw new Error(`source inconsistent with product_id: ${source} != ${parsedSource}`);
  }
  if (nativeId !== undefined && nativeId !== parsedNative) {
    throw new Error(`nativeId inconsistent with product_id: ${nativeId} != ${parsedNative}`);
  }
  if (availability !== undefined && !AVAILABILITY_VALUES.includes(availability)) {
    throw new Error(`invalid availability: ${availability}`);
  }
  return Object.freeze({
    productId,
    // exactOptionalPropertyTypes:未提供时不写可选键
    ...(source !== undefined ? { source } : {}),
    ...(nativeId !== undefined ? { nativeId } : {}),
    ...(availability !== undefined ? { availability } : {}),
  });
}

/** Recipe 中的来源引用(recipe-format:provider + 来源平台原生 productId) */
export interface RecipeSourceRef {
  readonly provider: string;
  readonly productId: string;
  /** 配方内自由文本变体选择描述——不是 CatalogVariantId,禁止隐式映射 */
  readonly variant?: string;
}

/**
 * CatalogVariantId 唯一显式解析入口(当前仅做非空校验;BDB 正式契约后
 * 升级为契约校验或用户确认流程,见 G2-B / M7 前置门)。
 */
export function parseCatalogVariantId(raw: string): CatalogVariantId {
  if (raw.trim().length === 0) {
    throw new Error("CatalogVariantId must not be empty");
  }
  return raw as CatalogVariantId;
}

/** 来源关联验证状态:只记录事实,不携带流程含义(确认流程留 G13 评审) */
export type AssetSourceVerification = "candidate" | "unverified" | "verified";

/** 本地素材记录:可选来源关联为候选,须经用户确认,不证明拥有/兼容/可得 */
export interface AssetRecord {
  readonly id: string;
  readonly sourceCandidate?: CatalogProductRef;
  /** 关联验证状态;缺省按 candidate(系统猜测)处理 */
  readonly sourceVerification?: AssetSourceVerification;
  /** 显示回退:仅有商品引用(未解析出实体)时的卖家原文标题——
   *  识别失败的素材节点显示原文,不得留空 */
  readonly displayFallback?: string;
}

/** 语义实体引用(仅 Avatar 等,UUIDv7) */
export interface EntityRef {
  readonly entityId: string;
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** EntityRef 唯一构造入口:校验 UUIDv7 形态,防止商品 id 混入语义实体身份 */
export function entityRef(entityId: string): EntityRef {
  if (!UUID_V7_PATTERN.test(entityId)) {
    throw new Error(`invalid UUIDv7 entity id: ${entityId}`);
  }
  return Object.freeze({ entityId });
}

/** 目录价格:字符串金额 + ISO 币种(禁用 JS number) */
export interface CatalogPrice {
  readonly amount: string;
  readonly currency: string;
  /** 汇率估算标注:存在即表示该金额为本地估算值而非牌价;
   *  cachedAt 为估算所用汇率的缓存时间(ISO 8601),UI 必须标注估算性质 */
  readonly estimate?: { readonly cachedAt: string };
  /** 多变体价区间上限(1400~2400 的 2400);缺省 = 单值 */
  readonly high?: string | null;
}
