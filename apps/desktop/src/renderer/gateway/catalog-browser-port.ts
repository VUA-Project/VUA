import type { CatalogStatus } from "./catalog.ts";
import type { CatalogAvailability, CatalogPrice } from "./refs.ts";
import type { CapabilityReport } from "./types.ts";

/**
 * 目录浏览只读窄端口(G8):Warehouse 卡片墙的取数口。
 *
 * 定位:
 * - 这是 BDB 目录端口的"浏览切片"——只读列表/详情/状态;激活、在线回退、
 *   增量同步等写路径在 G13 才并入,届时本端口向其演进,页面零重写
 *   (实现整体替换)。
 * - 领域类型,不是 wire DTO:wire 形态只允许存在于各实现的解析层
 *   (快照:catalog-browser-snapshot.ts;live:catalog-browser-live.ts),
 *   不得透出到表现层。
 * - 双实现:live(bdl-queries v0.3 冻结面,经 typed Gateway client)与
 *   快照 fixture(契约测试用的 BDB 0.2 草案样本),同一组契约测试约束;
 *   无宿主时退 not-connected 诚实空态(empty-gateway)。
 *
 * 身份纪律(承接 refs.ts):
 * - productId 是 BDB 规范 product_id,v0.3 = "booth:<数字>" 命名空间,
 *   live 投影时校验形态,形态不齐的条目如实丢弃;
 * - entityId 在本端口一律不透明 string——API 0.4 实体是 UUIDv4,而
 *   refs.ts 的 EntityRef 语义实体身份(UUIDv7)尚未裁决(Issue #14 §2),
 *   此处禁止构造 EntityRef,只做展示与过滤用途。
 */

/** 实体间关系种类(API 0.2 仅此三种;新种类前向兼容策略见解析层) */
export type CatalogRelationKind = "compatible_with" | "addon_for" | "requires";

/**
 * 可用性派生稳定枚举(bdl-queries v0.3):由 AMF/BDL 处理器按版本化规则表
 * 从观测原词派生;徽标与筛选只消费它,原词证据走 availabilityRaw。
 * deleted 是徽标词表的墓碑态而非派生枚举成员——墓碑不进 v0.3 目录面。
 */
export type CatalogAvailabilityStatus = "available" | "unavailable" | "unknown";

/** 列表查询:全部条件 AND 组合;缺省不过滤 */
export type CatalogLibraryType = "bought" | "gifts" | "free_downloads";

export interface CatalogBrowserQuery {
  /** 标题 / productId 子串匹配(大小写不敏感) */
  readonly text?: string;
  /** 对派生稳定枚举精确匹配;live 随请求发送,由 AMF 侧过滤 */
  readonly availabilityStatus?: CatalogAvailabilityStatus;
  /** BDL v0.3/bdl-queries v0.6:按账号库类型精确匹配(已购/礼物/免费) */
  readonly libraryType?: CatalogLibraryType;
  /** 分页:1–200,缺省 50(AMF 默认);快照实现本地应用 */
  readonly limit?: number;
  /** 分页偏移:≥ 0,缺省 0 */
  readonly offset?: number;
  /**
   * 退役保留字段位:v0.3 无实体/关系存储,live 不随请求发送(wire 收到即
   * 契约错误);快照实现保留本地过滤,词表成文随 BDL v2 回归。
   */
  readonly entityType?: string;
  readonly relationKind?: CatalogRelationKind;
}

/** 卡片墙条目(列表视图的最小展示单元) */
export interface CatalogProductSummary {
  readonly productId: string;
  /** v0.3 允许无题观测:未解析出标题时为 null,UI 回落 productId */
  readonly title: string | null;
  /** BDL v0.3:条目来自哪个账号库(已购/礼物/免费);null = 未知 */
  readonly libraryType: CatalogLibraryType | null;
  /** N5 D2:经 artifact_mappings 关联的本地工件数;0 = 仅云端,>0 = 已入库 */
  readonly importedArtifacts: number;
  /** 库行观察到的店铺显示名(null = 未知);卡片店铺行 */
  readonly shopName: string | null;
  /** 购买变体标记(库行尾缀拆出;null = 未区分) */
  readonly variantName: string | null;
  /** 字符串金额 + 币种;来源缺价格时为 null,UI 显示"无价格信息"而非猜测 */
  readonly price: CatalogPrice | null;
  readonly imageUrl: string | null;
  /**
   * 相册数据源:详情媒体的完整图片数组;详情缺媒体时回落 [imageUrl],
   * 无图为空数组。imageUrl 恒等于 imageUrls[0] 或 null。
   */
  readonly imageUrls: readonly string[];
  /** 徽标词表(四值,含墓碑):live 以派生枚举填充,快照按原词解析 */
  readonly availability: CatalogAvailability;
  /**
   * 观测原词证据(v0.3 双字段):可为裸词或完整 schema.org URL,永不归一化;
   * 只在详情作证据展示,徽标与筛选不消费它。
   */
  readonly availabilityRaw: string | null;
  readonly entityCount: number;
  /** 该商品实体的类型去重集合(筛选词表与卡片徽标的来源);v0.3 恒空 */
  readonly entityTypes: readonly string[];
}

/** 变体条目(多版本商品的子品卡片;单价商品的变体价只在这里) */
export interface CatalogSubproduct {
  /** 平台原生变体标识,缺失为 null */
  readonly variationId: string | null;
  readonly name: string | null;
  readonly price: CatalogPrice | null;
  /** 观测原词证据(同 summary 双字段纪律) */
  readonly availabilityRaw: string | null;
  /** 徽标词表;live 以派生枚举填充 */
  readonly availability: CatalogAvailability;
}

/** 实体摘要:详情抽屉的实体区与关系徽标使用 */
export interface CatalogEntityBrief {
  /** 不透明实体标识(API 0.4 为 UUIDv4;禁止构造 EntityRef,见文件头) */
  readonly entityId: string;
  readonly entityType: string;
  readonly canonicalName: string | null;
  readonly relations: readonly CatalogRelationBrief[];
}

export interface CatalogRelationBrief {
  readonly kind: CatalogRelationKind;
  readonly objectEntityId: string;
  /**
   * 关系对象规范名。解析顺序:/entities/{id} 档案 → 目录内实体名索引
   * (详情记录里同目录其他商品的实体,档案因 BDB 端点故障受阻时仍可补名)
   * → 库外实体为 null(UI 回落只显示关系种类,不编造名称)。
   */
  readonly objectName: string | null;
}

/** 商品详情(详情抽屉视图) */
export interface CatalogProductDetail {
  readonly productId: string;
  /** v0.3 允许无题观测:未解析出标题时为 null,UI 回落 productId */
  readonly title: string | null;
  /** BDL v0.3:来自哪个账号库(null = 未知);详情证据展示 */
  readonly libraryType: CatalogLibraryType | null;
  /** 商品页观察的上架日期原文(null = 未观察) */
  readonly sourcePublishedAt: string | null;
  /** 购买变体标记(库行尾缀;null = 未区分) */
  readonly variantName: string | null;
  /** 商品页观察的变体列表(名+价+售罄;空 = 未富化) */
  readonly variations: readonly {
    readonly variationId: string | null;
    readonly name: string | null;
    readonly price: CatalogPrice | null;
    readonly soldOut: boolean;
  }[];
  readonly price: CatalogPrice | null;
  readonly imageUrl: string | null;
  /** deleted 即墓碑:保留最后标题与主图,UI 须明确表达"已下架/墓碑" */
  readonly availability: CatalogAvailability;
  /** 观测原词证据(v0.3 双字段);详情作证据展示 */
  readonly availabilityRaw: string | null;
  readonly sourceUrl: string | null;
  readonly sourceLocale: string | null;
  readonly description: string | null;
  readonly attribution: {
    readonly shopName: string | null;
    readonly shopUrl: string | null;
    readonly creatorName: string | null;
  } | null;
  /** 仅显式 BOOTH Adult 徽标为真;false 不是"未知的假",是"未见徽标" */
  readonly adult: boolean;
  /** BOOTH 年龄限制原文(R-15/R-18 等),无徽标为 null */
  readonly ageRestriction: string | null;
  /** BOOTH 展示分类原文,无推断 */
  readonly sourceCategory: string | null;
  readonly media: {
    readonly imageUrls: readonly string[];
    readonly videoUrls: readonly string[];
  };
  readonly terms: readonly {
    readonly termKey: string;
    readonly termKind: string;
    readonly label: string | null;
  }[];
  readonly subproducts: readonly CatalogSubproduct[];
  readonly entities: readonly CatalogEntityBrief[];
}

/**
 * W17 透传呈现:application 错误按冻结稳定码(vua.catalog.*)收窄为白名单
 * messageKey(键先行,provider 在错误通道下发同值),页面经 strings.errors
 * 解析;词表外码回落 fallback,不猜测具体原因。product_not_found 不入此
 * 表——未命中是独立事实形态(kind "not-found"),不是错误文案。
 */
export type CatalogErrorKey =
  | "errors.catalog.invalidParams"
  | "errors.catalog.unavailable"
  | "errors.catalog.storeFailed"
  | "errors.catalog.fallback";

export type CatalogListView =
  | { schemaVersion: 1; kind: "not-connected" }
  | { schemaVersion: 1; kind: "error"; messageKey: CatalogErrorKey }
  | {
      schemaVersion: 1;
      kind: "results";
      /** 过滤后的条目 */
      readonly items: readonly CatalogProductSummary[];
      /** 目录全量大小(未过滤),供"N / 共 M"计数表达 */
      readonly total: number;
      /** 筛选词表:实现从目录数据派生,与当前过滤条件无关 */
      readonly vocabulary: CatalogVocabulary;
    };

/** 筛选词表:由实现从目录派生,与当前过滤条件无关 */
export interface CatalogVocabulary {
  /** 派生稳定枚举面(live 恒为闭集全集;快照按数据出现值) */
  readonly availabilities: readonly CatalogAvailabilityStatus[];
  readonly entityTypes: readonly string[];
  readonly relationKinds: readonly CatalogRelationKind[];
}

export type CatalogDetailView =
  | { schemaVersion: 1; kind: "not-connected" }
  | { schemaVersion: 1; kind: "not-found" }
  | { schemaVersion: 1; kind: "error"; messageKey: CatalogErrorKey }
  | { schemaVersion: 1; kind: "detail"; product: CatalogProductDetail };

export interface CatalogBrowserPort {
  list(query?: CatalogBrowserQuery): Promise<CatalogListView>;
  detail(productId: string): Promise<CatalogDetailView>;
  /** 目录新鲜度视图(catalog.ts 词汇;修订序号语义见 CatalogRevision) */
  status(): Promise<CatalogStatus>;
  capability(): Promise<CapabilityReport>;
}
