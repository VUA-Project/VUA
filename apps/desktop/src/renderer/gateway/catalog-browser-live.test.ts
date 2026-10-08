import { describe, expect, it } from "vitest";
import type {
  DesktopGatewayRequestV1,
  DesktopGatewaySuccessValueV1,
} from "@vua/contracts";
import type { GatewayClient, GatewayResult } from "./gateway-client.ts";
import { createLiveCatalogBrowser } from "./catalog-browser-live.ts";
import type { CatalogDetailView, CatalogListView } from "./catalog-browser-port.ts";

/**
 * F4-5 live 云端目录轨端口测试:catalog.list / catalog.detail / catalog.status
 * 的 wire 投影(client 纪律)、诚实空态语义与能力门控。不经 Kernel 全链路
 * (路由臂由 contracts 守卫测试与 mock provider 覆盖)。
 * BOARD #36 缺陷②同类修复批(2026-09-18):mock 应答统一钉 live 形状
 * (bdl-queries 三键信封,schemaVersion "0.6" + operation + result)——
 * 此前 mock 钉契约平铺值、live 实答带信封,测试全绿真机不通(#22 教训);
 * 并以负例钉死「平铺值按不可解释处理」,防回摆。
 */

function wireSummary(overrides: Record<string, unknown> = {}) {
  return {
    productId: "booth:3681787",
    title: "Sample Outfit",
    price: { amount: "1980", currency: "JPY", high: null },
    imageUrl: "https://booth.pm/img/3681787/main.jpg",
    imageUrls: ["https://booth.pm/img/3681787/main.jpg"],
    availabilityRaw: "compliant",
    availabilityStatus: "available",
    entityCount: 0,
    entityTypes: [],
    ...overrides,
  };
}

function wireSubproduct(overrides: Record<string, unknown> = {}) {
  return {
    variationId: "v1",
    name: "Miku color",
    price: { amount: "1980", currency: "JPY", high: null },
    availabilityRaw: null,
    availabilityStatus: "available",
    ...overrides,
  };
}

function wireDetail(overrides: Record<string, unknown> = {}) {
  return {
    productId: "booth:3681787",
    title: null,
    price: null,
    imageUrl: null,
    imageUrls: ["https://booth.pm/img/3681787/b.jpg"],
    availabilityRaw: "compliant",
    availabilityStatus: "available",
    entityCount: 0,
    entityTypes: [],
    description: "Outfit description",
    shopName: "ShopA",
    shopUrl: "https://shopa.booth.pm/",
    adult: true,
    ageRestriction: "R-18",
    videoUrls: ["https://example.test/movie.mp4"],
    sourceCategory: "Clothing",
    subproducts: [wireSubproduct()],
    ...overrides,
  };
}

const okValue = (value: unknown): GatewayResult<DesktopGatewaySuccessValueV1> => ({
  ok: true,
  value: value as DesktopGatewaySuccessValueV1,
});

/** bdl-queries live 信封(provider-host bdl_query_success 同形) */
const okBdl = (operation: string, result: unknown): GatewayResult<DesktopGatewaySuccessValueV1> =>
  okValue({ schemaVersion: "0.6", operation, result });

const errApplication = (code: string): GatewayResult<DesktopGatewaySuccessValueV1> => ({
  ok: false,
  error: {
    kind: "application",
    error: {
      contractVersion: "0.1",
      code,
      category: "validation",
      messageKey: "errors.test",
      recoverable: false,
      retryable: false,
      correlationId: "corr",
    },
  },
});

const errUnavailable: GatewayResult<DesktopGatewaySuccessValueV1> = {
  ok: false,
  error: { kind: "unavailable" },
};

interface StubClient extends GatewayClient {
  /** 覆盖下一次 invoke 回执(队列空时回 unavailable) */
  queue(result: GatewayResult<DesktopGatewaySuccessValueV1>): void;
  /** 逐条记录已发出的 wire 请求(params 一并保留) */
  sent(): { method: string; params: Record<string, unknown> }[];
}

function stubClient(): StubClient {
  const queue: GatewayResult<DesktopGatewaySuccessValueV1>[] = [];
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  return {
    queue: (result) => {
      queue.push(result);
    },
    sent: () => requests,
    async invoke(request: DesktopGatewayRequestV1) {
      requests.push({ method: request.method, params: request.params as Record<string, unknown> });
      return queue.length > 0
        ? (queue.shift() as GatewayResult<DesktopGatewaySuccessValueV1>)
        : errUnavailable;
    },
    subscribe() {
      return () => {};
    },
  };
}

describe("live catalog browser port (F4-5)", () => {
  it("projects catalog.list wire values into summary domain types", async () => {
    const client = stubClient();
    client.queue(okBdl("catalog.list", {
      total: 1,
      entries: [wireSummary({ imageUrl: null })],
    }));
    const view: CatalogListView = await createLiveCatalogBrowser(client).list();
    expect(view.kind).toBe("results");
    if (view.kind !== "results") return;
    expect(view.total).toBe(1);
    // 词表 = 派生稳定枚举闭集全集;实体/关系词表诚实空(v0.3 无实体存储)
    expect(view.vocabulary.availabilities).toEqual(["available", "unavailable", "unknown"]);
    expect(view.vocabulary.entityTypes).toEqual([]);
    expect(view.vocabulary.relationKinds).toEqual([]);
    const item = view.items[0];
    expect(item?.title).toBe("Sample Outfit");
    expect(item?.price).toEqual({ amount: "1980", currency: "JPY", high: null });
    // 双字段:徽标消费派生枚举,原词证据原样保留
    expect(item?.availability).toBe("available");
    expect(item?.availabilityRaw).toBe("compliant");
    // imageUrl 缺失时按媒体首图收窄(imageUrl 恒等于 imageUrls[0] 或 null)
    expect(item?.imageUrl).toBe("https://booth.pm/img/3681787/main.jpg");
    expect(item?.entityCount).toBe(0);
  });

  it("drops entries with out-of-vocabulary status or malformed identity", async () => {
    const client = stubClient();
    client.queue(okBdl("catalog.list", {
      total: 4,
      entries: [
        wireSummary(),
        wireSummary({ productId: "booth:1111111", availabilityStatus: "discontinued" }),
        wireSummary({ productId: "shopify:42" }),
        wireSummary({ productId: "booth:not-a-number" }),
      ],
    }));
    const view = await createLiveCatalogBrowser(client).list();
    expect(view.kind).toBe("results");
    if (view.kind !== "results") return;
    // 词表外/身份形态不齐的条目如实丢弃,不渲染半可信条目
    expect(view.items.map((item) => item.productId)).toEqual(["booth:3681787"]);
  });

  it("renders an empty catalog honestly as results-empty, not not-connected", async () => {
    const client = stubClient();
    // BDL 未落观测数据:服务面就绪,空态即终态,不谎报 not-connected
    client.queue(okBdl("catalog.list", { total: 0, entries: [] }));
    const port = createLiveCatalogBrowser(client);
    const view = await port.list();
    expect(view).toEqual({
      schemaVersion: 1,
      kind: "results",
      items: [],
      total: 0,
      vocabulary: {
        availabilities: ["available", "unavailable", "unknown"],
        entityTypes: [],
        relationKinds: [],
      },
    });
    // capability 探 status:空目录仍应答,服务面就绪即 ready
    client.queue(okBdl("catalog.status", { health: "unknown", revision: { datasetRevision: "0.3" } }));
    expect((await port.capability()).state).toBe("ready");
  });

  it("falls back to honest empty views on failure instead of throwing", async () => {
    const client = stubClient(); // 队列空 → unavailable
    const port = createLiveCatalogBrowser(client);
    expect(await port.list()).toEqual({ schemaVersion: 1, kind: "not-connected" });
    expect(await port.detail("booth:3681787")).toEqual({ schemaVersion: 1, kind: "not-connected" });
    expect(await port.status()).toEqual({ health: "unknown" });
    expect(await port.capability()).toEqual({ state: "unavailable", detailKey: "catalogMissing" });

    // 形态不齐(信封缺 result 本体键)按未接入处理,不渲染半可信详情
    client.queue(okBdl("catalog.detail", {}));
    expect((await port.detail("booth:3681787")).kind).toBe("not-connected");

    // #22 回摆钉死:契约平铺值(无信封)在 live 形状纪律下按不可解释处理,
    // 永不因「恰好读得到」回退平铺读
    client.queue(okValue({ total: 1, entries: [wireSummary()] }));
    expect((await port.list()).kind).toBe("not-connected");

    // 未知/墓碑 productId → 诚实 not-found(应用错误透传呈现)
    client.queue(errApplication("vua.catalog.product_not_found"));
    expect((await port.detail("booth:3681787")).kind).toBe("not-found");

    // 身份形态不齐的查询不投递必败请求,直接诚实 not-found
    expect((await port.detail("shopify:42")).kind).toBe("not-found");
    // 前三条走线 detail 各一次;形态不齐身份未发请求
    expect(client.sent().filter((r) => r.method === "catalog.detail")).toHaveLength(3);
  });

  it("surfaces application errors as typed error views (W17 pass-through)", async () => {
    const client = stubClient();
    const port = createLiveCatalogBrowser(client);

    // 冻结码 → 白名单键(list 与 detail 同规则);messageKey 经 strings.errors 解析
    client.queue(errApplication("vua.catalog.invalid_params"));
    expect(await port.list()).toEqual({
      schemaVersion: 1,
      kind: "error",
      messageKey: "errors.catalog.invalidParams",
    });
    client.queue(errApplication("vua.catalog.store_failed"));
    expect(await port.list()).toEqual({
      schemaVersion: 1,
      kind: "error",
      messageKey: "errors.catalog.storeFailed",
    });
    client.queue(errApplication("vua.catalog.unavailable"));
    expect(await port.detail("booth:3681787")).toEqual({
      schemaVersion: 1,
      kind: "error",
      messageKey: "errors.catalog.unavailable",
    });

    // 词表外 application 码 → fallback,不猜测具体原因
    client.queue(errApplication("vua.catalog.something_new"));
    expect(await port.detail("booth:3681787")).toEqual({
      schemaVersion: 1,
      kind: "error",
      messageKey: "errors.catalog.fallback",
    });

    // 未命中(product_not_found)是 not-found 事实形态,不是错误文案(W12 语义不变)
    client.queue(errApplication("vua.catalog.product_not_found"));
    expect((await port.detail("booth:3681787")).kind).toBe("not-found");

    // 传输面失败(服务未达)仍是 not-connected,不冒充错误文案
    client.queue(errUnavailable);
    expect((await port.list()).kind).toBe("not-connected");
    client.queue(errUnavailable);
    expect((await port.detail("booth:3681787")).kind).toBe("not-connected");
  });

  it("maps detail increments honestly: adult/sourceCategory/subproducts/empty slots", async () => {
    const client = stubClient();
    client.queue(okBdl("catalog.detail", { product: wireDetail() }));
    const detail: CatalogDetailView = await createLiveCatalogBrowser(client).detail("booth:3681787");
    expect(detail.kind).toBe("detail");
    if (detail.kind !== "detail") return;
    const product = detail.product;
    // v0.3 增量字段逐项透传(无题观测回落由 UI 消费 null)
    expect(product.title).toBeNull();
    expect(product.adult).toBe(true);
    expect(product.ageRestriction).toBe("R-18");
    expect(product.sourceCategory).toBe("Clothing");
    expect(product.media.videoUrls).toEqual(["https://example.test/movie.mp4"]);
    expect(product.subproducts).toEqual([
      {
        variationId: "v1",
        name: "Miku color",
        price: { amount: "1980", currency: "JPY", high: null },
        availabilityRaw: null,
        availability: "available",
      },
    ]);
    expect(product.attribution).toEqual({
      shopName: "ShopA",
      shopUrl: "https://shopa.booth.pm/",
      creatorName: null,
    });
    // v0.3 无来源页/词条/实体存储:诚实空槽,不编造
    expect(product.sourceUrl).toBeNull();
    expect(product.sourceLocale).toBeNull();
    expect(product.terms).toEqual([]);
    expect(product.entities).toEqual([]);
  });

  it("maps status across the wire health vocabulary; failure degrades to unknown", async () => {
    const client = stubClient();
    const port = createLiveCatalogBrowser(client);
    for (const health of ["unknown", "ok", "incompatible"] as const) {
      client.queue(okBdl("catalog.status", {
        health,
        revision: { catalogUpdatedSeq: health === "ok" ? 7 : null, datasetRevision: "0.3" },
      }));
      const status = await port.status();
      expect(status.health).toBe(health);
      expect(status.revision).toEqual({
        catalogUpdatedSeq: health === "ok" ? 7 : null,
        datasetRevision: "0.3",
      });
    }
    // 非协议健康词(渲染层预留态 stale 永不来自 wire)按未接入 → unknown
    client.queue(okBdl("catalog.status", { health: "stale", revision: { datasetRevision: "0.3" } }));
    expect((await port.status()).health).toBe("unknown");
  });

  it("capability probes catalog.status: ready once the service face answers", async () => {
    const client = stubClient();
    const port = createLiveCatalogBrowser(client);
    client.queue(okBdl("catalog.status", { health: "unknown", revision: { datasetRevision: "0.3" } }));
    expect(await port.capability()).toEqual({ state: "ready" });
    client.queue(errUnavailable);
    expect(await port.capability()).toEqual({ state: "unavailable", detailKey: "catalogMissing" });
    // 探测用最轻的 status 查询,不预读全量列表
    expect(client.sent().every((r) => r.method === "catalog.status")).toBe(true);
  });

  it("passes pagination and closed-set query params verbatim; retired fields are never sent", async () => {
    const client = stubClient();
    client.queue(okBdl("catalog.list", { total: 0, entries: [] }));
    await createLiveCatalogBrowser(client).list({
      text: "  outfit  ",
      availabilityStatus: "unavailable",
      limit: 100,
      offset: 50,
      // 退役保留字段位:v0.3 wire 收到即契约错误,live 绝不发送
      entityType: "outfit",
      relationKind: "compatible_with",
    });
    const [request] = client.sent();
    expect(request?.method).toBe("catalog.list");
    expect(request?.params).toEqual({
      text: "outfit",
      availabilityStatus: "unavailable",
      limit: 100,
      offset: 50,
    });
  });
});
