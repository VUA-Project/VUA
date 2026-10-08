import type {
  CatalogAvailabilityStatus,
  CatalogBrowserQuery,
  CatalogPrice,
  CatalogRelationKind,
} from "../../gateway/index.ts";

/**
 * Warehouse 页面查询状态(纯逻辑,可测)。
 * 表单值用 "" 表示"不筛选";toPortQuery 负责收敛为端口查询。
 * 可用性筛选消费 v0.3 派生稳定枚举(availabilityStatus),原词不进筛选。
 */

export interface WarehouseQueryState {
  readonly text: string;
  readonly availabilityStatus: CatalogAvailabilityStatus | "";
  /** 退役保留字段位:v0.3 无实体/关系存储,live 端口不发送 */
  readonly entityType: string | "";
  readonly relationKind: CatalogRelationKind | "";
}

export const emptyWarehouseQuery: WarehouseQueryState = {
  text: "",
  availabilityStatus: "",
  entityType: "",
  relationKind: "",
};

/** 表单状态 -> 端口查询:空值不进入查询,文本去首尾空白 */
export function toPortQuery(state: WarehouseQueryState): CatalogBrowserQuery {
  const query: {
    text?: string;
    availabilityStatus?: CatalogAvailabilityStatus;
    entityType?: string;
    relationKind?: CatalogRelationKind;
  } = {};
  const text = state.text.trim();
  if (text.length > 0) query.text = text;
  if (state.availabilityStatus !== "") query.availabilityStatus = state.availabilityStatus;
  if (state.entityType !== "") query.entityType = state.entityType;
  if (state.relationKind !== "") query.relationKind = state.relationKind;
  return query;
}

/**
 * 是否有生效中的筛选:区分"搜索/筛选无结果"与"目录为空/未接入"——
 * 两种空态文案不同(ui-ux:搜索空 ≠ 未接入)。
 */
export function hasActiveFilter(state: WarehouseQueryState): boolean {
  return (
    state.text.trim().length > 0 ||
    state.availabilityStatus !== "" ||
    state.entityType !== "" ||
    state.relationKind !== ""
  );
}

/**
 * 目录空态卡推导(N5 S1):目录为空且未加筛选时,按登录线索决定空卡形态——
 * "none" = 登录引导卡;"stored"/"unknown"/未探测 = 同步引导卡(探测失败不
 * 冒充事实,同步按钮照常可用);其余情形(hidden)保持原通用空态。
 */
export type CatalogEmptyCard =
  | { kind: "hidden" }
  | { kind: "sign-in" }
  | { kind: "sync-available" };

export function catalogEmptyCard(input: {
  readonly remoteBrowser: boolean;
  readonly signInHint: "stored" | "none" | "unknown" | null;
  readonly filtered: boolean;
  readonly catalogEmpty: boolean;
}): CatalogEmptyCard {
  if (!input.remoteBrowser || !input.catalogEmpty || input.filtered) {
    return { kind: "hidden" };
  }
  return input.signInHint === "none" ? { kind: "sign-in" } : { kind: "sync-available" };
}


/** 价格展示归类:金额为 "0" 视为免费;缺价格单列,不猜测为 0 */
export type PriceKind = "free" | "priced" | "none";

export function priceKind(price: CatalogPrice | null): PriceKind {
  if (price === null) return "none";
  return price.amount === "0" ? "free" : "priced";
}

/** 卡片相册激活前的悬停时长(毫秒;数值可调) */
export const CARD_ALBUM_HOVER_DELAY_MS = 2000;

/**
 * 卡片相册位置翻页(纯函数):光标 x 在媒体区内的相对位置 → 图片序号。
 * 媒体区宽被均分为 count 段,光标落入哪段显示哪张;clamp 到 [0, count-1]。
 */
export function albumIndexFromOffset(offsetX: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.min(Math.max(offsetX / width, 0), 1 - Number.EPSILON);
  return Math.min(Math.floor(ratio * count), count - 1);
}
