import type { CatalogStatus } from "./catalog.ts";
import {
  catalogProductRef,
  type CatalogAvailability,
  type CatalogPrice,
} from "./refs.ts";
import type {
  CatalogBrowserPort,
  CatalogBrowserQuery,
  CatalogAvailabilityStatus,
  CatalogDetailView,
  CatalogEntityBrief,
  CatalogListView,
  CatalogProductDetail,
  CatalogProductSummary,
  CatalogRelationBrief,
  CatalogRelationKind,
} from "./catalog-browser-port.ts";
import type { CapabilityReport } from "./types.ts";

/**
 * 目录浏览端口的快照实现(G8,DEV fixture 与契约测试共用)。
 *
 * 数据来自 tools/contract-vendor/api-snapshot.mjs 生成的 API 响应快照
 * (schemas/vendor/bdb-api-0.2,草案契约下的测试样本——不是冻结的 BDB 真相)。
 * 本文件是 wire 形态(API 0.2 下划线字段)的唯一知晓者:入参按 wire 校验,
 * 出参一律领域类型(catalog-browser-port.ts),wire DTO 不透出。
 *
 * 不可信数据处理纪律(快照虽经哈希校验,仍按不可信输入解析):
 * - availability 出现词表外新值 -> 归为 "unknown"(诚实缺省,绝不猜测为
 *   available);
 * - relation_kind 出现词表外新值 -> 跳过该条关系(前向兼容:新种类不该
 *   让旧前端崩溃;词表扩展是 G13 的显式工作);
 * - price 缺失/畸形 -> null(UI 显示"无价格信息",不猜 0);
 * - product_id 形态非法 -> 抛错(vendored 快照漂移应响亮失败,重跑
 *   api-snapshot.mjs 时被发现)。
 */

/* ---- wire 形态(API 0.2,仅本文件可见) ---- */

interface WirePrice {
  amount?: unknown;
  currency?: unknown;
}

interface WireProductListItem {
  product_id?: unknown;
  title?: unknown;
  price?: WirePrice | null;
  image_url?: unknown;
  entity_count?: unknown;
  availability?: unknown;
}

interface WireRelation {
  relation_kind?: unknown;
  object_entity_id?: unknown;
}

interface WireEntity {
  entity_id?: unknown;
  entity_type?: unknown;
  canonical_name?: unknown;
  relations?: unknown;
}

/** wire 形态:/entities/{id} 响应(辞典感知搜索的 aliases 唯一来源) */
interface WireEntityDetail {
  entity_id?: unknown;
  entity_type?: unknown;
  canonical_name?: unknown;
  aliases?: unknown;
}

interface WireProductDetail extends WireProductListItem {
  source_url?: unknown;
  source_locale?: unknown;
  description?: unknown;
  attribution?: {
    shop_name?: unknown;
    shop_url?: unknown;
    creator_name?: unknown;
  } | null;
  media?: {
    image_urls?: unknown;
    video_urls?: unknown;
  } | null;
  terms?: unknown;
  entities?: unknown;
}

/** 快照输入:列表页 items、逐商品详情响应与实体档案(/entities/{id}) */
export interface CatalogSnapshotData {
  readonly products: readonly WireProductListItem[];
  readonly details: readonly WireProductDetail[];
  /**
   * 实体档案:aliases 的唯一来源(API 0.2 商品详情不携带 aliases)。
   * 缺省时规范名仍可从目录内索引(详情记录实体)解析,但无别名;
   * 库外实体的关系对象名为 null。
   */
  readonly entities?: readonly WireEntityDetail[];
}

/* ---- wire -> 领域 解析 ---- */

const AVAILABILITY_VALUES: readonly CatalogAvailability[] = [
  "available",
  "unavailable",
  "unknown",
  "deleted",
];

/** 派生稳定枚举面(筛选词表与 availabilityStatus 过滤;墓碑不参与) */
const AVAILABILITY_STATUS_VALUES: readonly CatalogAvailabilityStatus[] = [
  "available",
  "unavailable",
  "unknown",
];

/**
 * 徽标词表 → 派生稳定枚举:墓碑(deleted)不属于三值枚举,返回 null
 * (不匹配任何 availabilityStatus 过滤,也不进筛选词表)。
 */
function availabilityStatusOf(availability: CatalogAvailability): CatalogAvailabilityStatus | null {
  return availability === "deleted" ? null : availability;
}

const RELATION_KINDS: readonly CatalogRelationKind[] = [
  "compatible_with",
  "addon_for",
  "requires",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseAvailability(value: unknown): CatalogAvailability {
  // 词表外新值归 unknown:诚实缺省,不猜测可得性(见文件头纪律)
  return AVAILABILITY_VALUES.includes(value as CatalogAvailability)
    ? (value as CatalogAvailability)
    : "unknown";
}

function parsePrice(value: WirePrice | null | undefined): CatalogPrice | null {
  const amount = asString(value?.amount);
  const currency = asString(value?.currency);
  return amount !== null && currency !== null ? { amount, currency } : null;
}

function parseProductId(value: unknown): string {
  const productId = asString(value);
  if (productId === null) {
    throw new Error(`catalog snapshot: missing product_id (${JSON.stringify(value)})`);
  }
  // 形态校验(vendored 快照漂移应响亮失败);返回值即规范 product_id
  return catalogProductRef({ productId }).productId;
}

function parseRelations(
  value: unknown,
  resolveName: (entityId: string) => string | null,
): CatalogRelationBrief[] {
  if (!Array.isArray(value)) return [];
  const relations: CatalogRelationBrief[] = [];
  for (const raw of value as WireRelation[]) {
    const kind = raw?.relation_kind;
    const objectEntityId = asString(raw?.object_entity_id);
    // 词表外 relation_kind 跳过(前向兼容,见文件头纪律)
    if (!RELATION_KINDS.includes(kind as CatalogRelationKind) || objectEntityId === null) {
      continue;
    }
    relations.push({
      kind: kind as CatalogRelationKind,
      objectEntityId,
      objectName: resolveName(objectEntityId),
    });
  }
  return relations;
}

function parseEntities(
  value: unknown,
  resolveName: (entityId: string) => string | null,
): CatalogEntityBrief[] {
  if (!Array.isArray(value)) return [];
  const entities: CatalogEntityBrief[] = [];
  for (const raw of value as WireEntity[]) {
    const entityId = asString(raw?.entity_id);
    const entityType = asString(raw?.entity_type);
    if (entityId === null || entityType === null) continue;
    entities.push({
      entityId,
      entityType,
      canonicalName: asString(raw?.canonical_name),
      relations: parseRelations(raw?.relations, resolveName),
    });
  }
  return entities;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/**
 * 主图解析:API 0.2 列表响应带 image_url,详情响应省略该字段(图在
 * media.image_urls)——主图取第一个可用来源:顶层 image_url → 媒体首图。
 * 快照实现据此补全,页面不感知 wire 的字段分布差异。
 */
function primaryImageUrl(
  topLevel: unknown,
  media: { image_urls?: unknown } | null | undefined,
): string | null {
  return asString(topLevel) ?? parseStringArray(media?.image_urls)[0] ?? null;
}

/* ---- 快照实现 ---- */

/** 实体档案:/entities/{id} 提供的规范名与别名(辞典感知搜索数据源) */
interface EntityProfile {
  readonly canonicalName: string | null;
  readonly aliases: readonly string[];
}

interface SnapshotRecord {
  readonly summary: CatalogProductSummary;
  readonly wire: WireProductDetail;
}

/**
 * 由内存中的快照数据构造端口实现。数据加载(Vite glob / fs)由调用方负责,
 * 本函数保持纯计算,node 契约测试可直接注入合成数据。
 */
export function createSnapshotCatalogBrowser(data: CatalogSnapshotData): CatalogBrowserPort {
  // 实体档案索引:aliases 的唯一来源(商品详情 wire 不携带 aliases)
  const entityProfiles = new Map<string, EntityProfile>();
  for (const raw of data.entities ?? []) {
    const entityId = asString(raw?.entity_id);
    if (entityId === null) continue;
    entityProfiles.set(entityId, {
      canonicalName: asString(raw?.canonical_name),
      aliases: parseStringArray(raw?.aliases),
    });
  }

  // 目录内实体名索引:从全部详情记录收集 entity_id → canonical_name。
  // 关系对象常指向同目录其他商品的实体(衣装 → 素体):即使该实体的档案
  // 因 BDB /entities/{id} 故障受阻(issue Aran52/VUA_BDB#9),也能用目录
  // 自身数据补名并纳入搜索域——这是罗马字/假名搜索统一的第一兜底。
  const catalogEntityNames = new Map<string, string>();
  for (const detail of data.details) {
    if (!Array.isArray(detail.entities)) continue;
    for (const raw of detail.entities as WireEntity[]) {
      const entityId = asString(raw?.entity_id);
      const name = asString(raw?.canonical_name);
      if (entityId !== null && name !== null && !catalogEntityNames.has(entityId)) {
        catalogEntityNames.set(entityId, name);
      }
    }
  }

  // 名称解析顺序:实体档案(aliases 权威源)→ 目录内索引 → null(库外/未识别)
  const resolveEntityName = (entityId: string): string | null =>
    entityProfiles.get(entityId)?.canonicalName ?? catalogEntityNames.get(entityId) ?? null;

  const records: SnapshotRecord[] = [];
  const byId = new Map<string, SnapshotRecord>();

  for (const detail of data.details) {
    const productId = parseProductId(detail.product_id);
    const entities = parseEntities(detail.entities, resolveEntityName);
    const entityTypes = [...new Set(entities.map((entity) => entity.entityType))].sort();
    const primary = primaryImageUrl(detail.image_url, detail.media);
    const mediaImages = parseStringArray(detail.media?.image_urls);
    byId.set(productId, {
      wire: detail,
      summary: {
        productId,
        title: asString(detail.title) ?? productId,
        libraryType: null,
        importedArtifacts: 0,
        variantName: null,
        shopName: null,
        price: parsePrice(detail.price),
        imageUrl: primary,
        // 相册数组:详情媒体全量;无媒体时由主图兜底成单图(列表兜底在下方回写)
        imageUrls: mediaImages.length > 0 ? mediaImages : primary !== null ? [primary] : [],
        availability: parseAvailability(detail.availability),
        // 观测原词证据:词表外取值不归一化,如实携带(徽标已归 unknown)
        availabilityRaw: asString(detail.availability),
        entityCount:
          typeof detail.entity_count === "number" ? detail.entity_count : entities.length,
        entityTypes,
      },
    });
  }

  // 列表以 /products 响应为准(详情只补充 entityTypes 等派生信息);
  // 有列表项缺详情的商品仍可出现(详情查询时 not-found 诚实表达)。
  // 详情记录缺主图时用列表项 image_url 兜底(详情响应省略该字段,见 primaryImageUrl);
  // 兜底同步回写 byId,详情查询拿到同一主图与同一相册数组。
  for (const item of data.products) {
    const productId = parseProductId(item.product_id);
    const existing = byId.get(productId);
    if (existing !== undefined && existing.summary.imageUrl !== null) {
      records.push(existing);
      continue;
    }
    const fallbackImage = primaryImageUrl(item.image_url, undefined);
    const fallbackGallery = fallbackImage !== null ? [fallbackImage] : [];
    const record =
      existing !== undefined
        ? {
            wire: existing.wire,
            summary: {
              ...existing.summary,
              imageUrl: fallbackImage,
              imageUrls:
                existing.summary.imageUrls.length > 0
                  ? existing.summary.imageUrls
                  : fallbackGallery,
            },
          }
        : {
            wire: item,
            summary: {
              productId,
              title: asString(item.title) ?? productId,
              libraryType: null,
        importedArtifacts: 0,
        variantName: null,
        shopName: null,
              price: parsePrice(item.price),
              imageUrl: fallbackImage,
              imageUrls: fallbackGallery,
              availability: parseAvailability(item.availability),
              availabilityRaw: asString(item.availability),
              entityCount: typeof item.entity_count === "number" ? item.entity_count : 0,
              entityTypes: [],
            },
          };
    records.push(record);
    if (existing !== undefined) byId.set(productId, record);
  }

  function matches(record: SnapshotRecord, query: CatalogBrowserQuery): boolean {
    const { summary } = record;
    if (query.availabilityStatus !== undefined) {
      // 派生稳定枚举精确匹配;墓碑不属于三值枚举,不匹配任何过滤
      if (availabilityStatusOf(summary.availability) !== query.availabilityStatus) {
        return false;
      }
    }
    if (query.entityType !== undefined && !summary.entityTypes.includes(query.entityType)) {
      return false;
    }
    if (query.relationKind !== undefined) {
      const entities = parseEntities(record.wire.entities, resolveEntityName);
      if (!entities.some((entity) => entity.relations.some((r) => r.kind === query.relationKind))) {
        return false;
      }
    }
    if (query.text !== undefined && query.text.trim().length > 0) {
      const needle = query.text.trim().toLowerCase();
      // 辞典感知搜索域(对齐 API /products?q= 语义:title/shop_name/关联实体
      // canonical_name + aliases;前端不搜 description 长文——列表场景噪音大):
      // 任一别名写法(罗马字/假名/中文)命中同一商品;比 API 多一层"关系对象
      // 名与别名"——前端主路径是按 Avatar 找其衣装,关联经 relations 表达。
      // 关系对象名经 档案 → 目录内索引 两级解析,档案受阻时罗马字仍可命中。
      const haystacks = [summary.title, summary.productId];
      const shopName = asString(record.wire.attribution?.shop_name);
      if (shopName !== null) haystacks.push(shopName);
      const pushNames = (entityId: string) => {
        const name = resolveEntityName(entityId);
        if (name !== null) haystacks.push(name);
        const profile = entityProfiles.get(entityId);
        if (profile !== undefined) haystacks.push(...profile.aliases);
      };
      for (const entity of parseEntities(record.wire.entities, resolveEntityName)) {
        if (entity.canonicalName !== null) haystacks.push(entity.canonicalName);
        pushNames(entity.entityId);
        for (const relation of entity.relations) pushNames(relation.objectEntityId);
      }
      if (!haystacks.join("\n").toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  const detailCache = new Map<string, CatalogProductDetail>();

  // 筛选词表:全量目录中实际出现的取值(与过滤条件无关,UI 词表随数据走)
  const vocabulary = (() => {
    const availabilities = new Set<CatalogAvailabilityStatus>();
    const entityTypes = new Set<string>();
    const relationKinds = new Set<CatalogRelationKind>();
    for (const record of records) {
      // 墓碑不在三值枚举内,不进筛选词表
      const status = availabilityStatusOf(record.summary.availability);
      if (status !== null) availabilities.add(status);
      for (const type of record.summary.entityTypes) entityTypes.add(type);
      for (const entity of parseEntities(record.wire.entities, resolveEntityName)) {
        for (const relation of entity.relations) relationKinds.add(relation.kind);
      }
    }
    return {
      availabilities: AVAILABILITY_STATUS_VALUES.filter((value) => availabilities.has(value)),
      entityTypes: [...entityTypes].sort(),
      relationKinds: RELATION_KINDS.filter((kind) => relationKinds.has(kind)),
    };
  })();

  function parseDetail(record: SnapshotRecord): CatalogProductDetail {
    const cached = detailCache.get(record.summary.productId);
    if (cached) return cached;
    const { wire } = record;
    const attribution = wire.attribution
      ? {
          shopName: asString(wire.attribution.shop_name),
          shopUrl: asString(wire.attribution.shop_url),
          creatorName: asString(wire.attribution.creator_name),
        }
      : null;
    const terms = Array.isArray(wire.terms)
      ? wire.terms
          .map((raw: { term_key?: unknown; term_kind?: unknown; label?: unknown }) => {
            const termKey = asString(raw?.term_key);
            const termKind = asString(raw?.term_kind);
            return termKey === null || termKind === null
              ? null
              : { termKey, termKind, label: asString(raw?.label) };
          })
          .filter((term): term is NonNullable<typeof term> => term !== null)
      : [];
    const detail: CatalogProductDetail = {
      productId: record.summary.productId,
      libraryType: null,
      variantName: null,
      sourcePublishedAt: null,
      variations: [],
      title: record.summary.title,
      price: record.summary.price,
      imageUrl: record.summary.imageUrl,
      availability: record.summary.availability,
      availabilityRaw: record.summary.availabilityRaw,
      sourceUrl: asString(wire.source_url),
      sourceLocale: asString(wire.source_locale),
      description: asString(wire.description),
      attribution,
      // BDB 0.2 草案无 v0.3 增量字段:诚实缺省,等 live 面或草案升版携带
      adult: false,
      ageRestriction: null,
      sourceCategory: null,
      media: {
        imageUrls: parseStringArray(wire.media?.image_urls),
        videoUrls: parseStringArray(wire.media?.video_urls),
      },
      terms,
      subproducts: [],
      entities: parseEntities(wire.entities, resolveEntityName),
    };
    detailCache.set(record.summary.productId, detail);
    return detail;
  }

  return {
    list: (query: CatalogBrowserQuery = {}) => {
      const filtered = records.filter((record) => matches(record, query));
      return Promise.resolve<CatalogListView>({
        schemaVersion: 1,
        kind: "results",
        items: filtered.map((record) => record.summary),
        total: records.length,
        vocabulary,
      });
    },
    detail: (productId: string) => {
      const record = byId.get(productId);
      if (!record) {
        return Promise.resolve<CatalogDetailView>({ schemaVersion: 1, kind: "not-found" });
      }
      return Promise.resolve<CatalogDetailView>({
        schemaVersion: 1,
        kind: "detail",
        product: parseDetail(record),
      });
    },
    // 快照可读即 ok;新鲜度修订序号(catalog_updated_seq 等)待 G13 离线包契约
    status: () => Promise.resolve<CatalogStatus>({ health: "ok" }),
    capability: () => Promise.resolve<CapabilityReport>({ state: "ready" }),
  };
}
