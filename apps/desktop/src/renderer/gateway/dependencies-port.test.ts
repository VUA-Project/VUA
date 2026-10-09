import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DesktopGatewayRequestV1, DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import {
  createLiveDependenciesPort,
  createUnavailableDependenciesPort,
  narrowDependencyMatch,
  narrowDependencyObservation,
} from "./dependencies-port.ts";
import { emptyGateway } from "./empty-gateway.ts";
import { fixtureGateway } from "./fixture-gateway.ts";
import type { GatewayClient, GatewayResult } from "./gateway-client.ts";
import { strings as stringsEn } from "../i18n/strings.en.ts";
import { strings as stringsZh } from "../i18n/strings.zh-CN.ts";
import { strings as stringsJa } from "../i18n/strings.ja.ts";
import { strings as stringsKo } from "../i18n/strings.ko.ts";

/**
 * 依赖反查/观察列窄端口测试(bdl-queries v0.5 消费准备切片,2026-09-22;
 * 030 §5.7 案 A,数据席第 168 批 FROZEN):
 * - 收窄按冻结 Schema 键形:信封族常量 schemaVersion "0.6" + operation 精确
 *   命中;闭集词表外取值(恰钉五值草案成员 unity_or_sdk_version 拒绝 =
 *   BDL v0.2 N1 同一裁决面)、REQUIRED-nullable 键缺席、resolution 空
 *   evidence、身份形态不齐 = 整份不可解释 → absent(观察面是无过滤面,
 *   静默丢行会掩盖线索,不取列表丢弃先例);
 * - mock 穷尽臂:fake client 驱动 live 端口每一臂——成功两面对照(lookup
 *   建议面 confirmed-only/listByProduct 线索面 confirmed:false 如实出线)、
 *   诚实空集(total:0 = 无匹配名义)、应用错误码白名单、unknown_method →
 *   absent(核心接线批前实现域未接线的诚实缺席)、传输异常 → absent、
 *   垃圾信封 → absent、半可信行 → 整份 absent;
 * - 缺席臂:empty/fixture 装配恒 absent(不伪造线索/建议;能力缺席 =
 *   控制不渲染先例);
 * - 四语词面钉:dependencies.confidence 两档 + installSource 恰 advisory
 *   规则 v1 发射的两值(vpm/unknown 无行 = 不留死词面);可用性对骑既有
 *   warehouse.availability 三行(零死重复),每键四表命中非空。
 */

function asWire(value: unknown): DesktopGatewaySuccessValueV1 {
  return value as DesktopGatewaySuccessValueV1;
}

function ok(value: unknown): GatewayResult<DesktopGatewaySuccessValueV1> {
  return {
    schemaVersion: 1,
    requestId: "test",
    ok: true,
    value: asWire(value),
  } as GatewayResult<DesktopGatewaySuccessValueV1>;
}

function appError(
  code: string,
  category: "validation" | "unavailable" | "internal" = "validation",
): GatewayResult<DesktopGatewaySuccessValueV1> {
  return {
    schemaVersion: 1,
    requestId: "test",
    ok: false,
    error: {
      kind: "application",
      error: {
        contractVersion: "0.1",
        code,
        category,
        messageKey: "test",
        recoverable: false,
        retryable: false,
        correlationId: "test",
      },
    },
  } as unknown as GatewayResult<DesktopGatewaySuccessValueV1>;
}

function rejected(): GatewayResult<DesktopGatewaySuccessValueV1> {
  return {
    schemaVersion: 1,
    requestId: "test",
    ok: false,
    error: { kind: "request_rejected" },
  } as unknown as GatewayResult<DesktopGatewaySuccessValueV1>;
}

function fakeClient(
  invoke: (request: DesktopGatewayRequestV1) => Promise<GatewayResult<DesktopGatewaySuccessValueV1>>,
): GatewayClient {
  return { invoke, subscribe: () => () => {} };
}

/* 冻结正例向量逐字锚(schemas/bdl-queries/v0.6/examples,合成数据) */

const LOOKUP_RESULT = {
  schemaVersion: "0.6",
  operation: "dependencies.lookup",
  result: {
    total: 2,
    matches: [
      {
        productId: "booth:6584744",
        productTitle: "オリジナル3Dモデル ~ネコチヤン~",
        availabilityRaw: "https://schema.org/InStock",
        availabilityStatus: "available",
        depKind: "shader",
        depName: "liltoon",
        versionHint: "2.3.2~",
        rawQuote: "・liltoon 2.3.2~",
        sourceSpan: "body",
        extractionMethod: "explicit_heading",
        resolvedProductId: "booth:3087170",
        advisory: { installSource: "booth_page", confidence: "strong" },
      },
      {
        productId: "booth:8179865",
        productTitle: null,
        availabilityRaw: null,
        availabilityStatus: "unknown",
        depKind: "shader",
        depName: "lilToon",
        versionHint: null,
        rawQuote: "本ギミックはlilToonのカスタムパラメータとして作動します。",
        sourceSpan: "body",
        extractionMethod: "prose",
        resolvedProductId: null,
        advisory: null,
      },
    ],
  },
};

const LIST_BY_PRODUCT_RESULT = {
  schemaVersion: "0.6",
  operation: "dependencies.listByProduct",
  result: {
    productId: "booth:6584744",
    productStatus: "complete",
    observations: [
      {
        depKind: "shader",
        depName: "liltoon",
        versionHint: "2.3.2~",
        rawQuote: "・liltoon 2.3.2~",
        sourceSpan: "body",
        extractionMethod: "explicit_heading",
        extractedBy: "human",
        observedAt: "2026-09-22T00:00:00.000Z",
        resolution: {
          productId: "booth:3087170",
          confirmed: true,
          evidence: [
            {
              linkText: "lilToon",
              linkUrl: "https://lilxyzw.booth.pm/items/3087170",
              span: "description_link",
              note: "description link resolves to the lilToon product page",
            },
          ],
        },
      },
      {
        depKind: "other",
        depName: "Unity",
        versionHint: "2022.3.22f1",
        rawQuote: "- Unity 2022.3.22f1",
        sourceSpan: "body",
        extractionMethod: "bullet",
        extractedBy: "human",
        observedAt: "2026-09-22T00:00:00.000Z",
        resolution: null,
      },
      {
        depKind: "avatar_base",
        depName: "Lapwing",
        versionHint: null,
        rawQuote: "◎Liltoon",
        sourceSpan: "description_link",
        extractionMethod: "link",
        extractedBy: "dep-pipeline-0.1",
        observedAt: "2026-09-22T00:01:00.000Z",
        resolution: {
          productId: "booth:4993931",
          confirmed: false,
          evidence: [
            {
              linkText: "◎Liltoon",
              linkUrl: "https://booth.pm/ja/items/4993931",
              span: "description_link",
              note: null,
            },
          ],
        },
      },
    ],
  },
};

describe("narrowDependencyMatch (lookup suggestion face, frozen key shapes)", () => {
  it("accepts the frozen vector rows: confirmed resolution rides with advisory, unconfirmed stays off the suggestion face", () => {
    const confirmed = narrowDependencyMatch(LOOKUP_RESULT.result.matches[0]);
    expect(confirmed).not.toBeNull();
    expect(confirmed?.resolvedProductId).toBe("booth:3087170");
    expect(confirmed?.advisory).toEqual({ installSource: "booth_page", confidence: "strong" });

    // 未确认/无消解行:null = 不区分不泄露;advisory null = 不出建议
    const clue = narrowDependencyMatch(LOOKUP_RESULT.result.matches[1]);
    expect(clue).not.toBeNull();
    expect(clue?.resolvedProductId).toBeNull();
    expect(clue?.advisory).toBeNull();
    expect(clue?.productTitle).toBeNull();
    expect(clue?.versionHint).toBeNull();
  });

  it("rejects closed-set escapes and identity-shape violations (v0.2 N1 face: unity_or_sdk_version is out of vocabulary)", () => {
    const row = LOOKUP_RESULT.result.matches[0] as Record<string, unknown>;
    expect(narrowDependencyMatch({ ...row, depKind: "unity_or_sdk_version" })).toBeNull();
    expect(narrowDependencyMatch({ ...row, sourceSpan: "footer" })).toBeNull();
    expect(narrowDependencyMatch({ ...row, extractionMethod: "caption" })).toBeNull();
    expect(narrowDependencyMatch({ ...row, availabilityStatus: "InStock" })).toBeNull();
    expect(narrowDependencyMatch({ ...row, advisory: { installSource: "vpm", confidence: "strong" } })).not.toBeNull();
    expect(narrowDependencyMatch({ ...row, advisory: { installSource: "carrier_pigeon", confidence: "strong" } })).toBeNull();
    expect(narrowDependencyMatch({ ...row, advisory: { installSource: "booth_page", confidence: "medium" } })).toBeNull();
    expect(narrowDependencyMatch({ ...row, productId: "lil" })).toBeNull();
    expect(narrowDependencyMatch({ ...row, resolvedProductId: "booth:lil" })).toBeNull();
  });

  it("rejects rows with missing REQUIRED-nullable keys or mis-typed facts (never renders half-trusted suggestions)", () => {
    const row = LOOKUP_RESULT.result.matches[0] as Record<string, unknown>;
    const without = (key: string): Record<string, unknown> => {
      const { [key]: _omitted, ...rest } = row;
      return rest;
    };
    expect(narrowDependencyMatch(without("productTitle"))).toBeNull();
    expect(narrowDependencyMatch(without("availabilityRaw"))).toBeNull();
    expect(narrowDependencyMatch(without("versionHint"))).toBeNull();
    expect(narrowDependencyMatch(without("resolvedProductId"))).toBeNull();
    expect(narrowDependencyMatch(without("advisory"))).toBeNull();
    expect(narrowDependencyMatch({ ...row, productTitle: 42 })).toBeNull();
    expect(narrowDependencyMatch({ ...row, rawQuote: "" })).toBeNull();
    expect(narrowDependencyMatch(null)).toBeNull();
    expect(narrowDependencyMatch("text")).toBeNull();
  });
});

describe("narrowDependencyObservation (unfiltered clue face, frozen key shapes)", () => {
  it("accepts the frozen vector rows including the labeled clue (confirmed:false stays visible, never flipped)", () => {
    const confirmed = narrowDependencyObservation(LIST_BY_PRODUCT_RESULT.result.observations[0]);
    expect(confirmed).not.toBeNull();
    expect(confirmed?.resolution?.confirmed).toBe(true);
    expect(confirmed?.resolution?.evidence).toHaveLength(1);

    const pinRow = narrowDependencyObservation(LIST_BY_PRODUCT_RESULT.result.observations[1]);
    expect(pinRow).not.toBeNull();
    expect(pinRow?.resolution).toBeNull();
    expect(pinRow?.versionHint).toBe("2022.3.22f1");

    // 030 §1 样例 3 错链:带标注线索如实出线,确认状态绝不翻转
    const mislink = narrowDependencyObservation(LIST_BY_PRODUCT_RESULT.result.observations[2]);
    expect(mislink).not.toBeNull();
    expect(mislink?.resolution?.confirmed).toBe(false);
    expect(mislink?.resolution?.evidence[0]?.note).toBeNull();
  });

  it("rejects closed-set escapes, empty evidence, missing keys, and mis-typed facts (whole-row uninterpretable)", () => {
    const row = LIST_BY_PRODUCT_RESULT.result.observations[0] as Record<string, unknown>;
    const without = (key: string): Record<string, unknown> => {
      const { [key]: _omitted, ...rest } = row;
      return rest;
    };
    expect(narrowDependencyObservation({ ...row, depKind: "unity_or_sdk_version" })).toBeNull();
    expect(narrowDependencyObservation({ ...row, sourceSpan: "footer" })).toBeNull();
    expect(narrowDependencyObservation({ ...row, extractedBy: "" })).toBeNull();
    expect(narrowDependencyObservation(without("extractedBy"))).toBeNull();
    expect(narrowDependencyObservation(without("observedAt"))).toBeNull();
    expect(narrowDependencyObservation(without("versionHint"))).toBeNull();
    expect(narrowDependencyObservation(without("resolution"))).toBeNull();
    const resolution = row.resolution as Record<string, unknown>;
    expect(narrowDependencyObservation({ ...row, resolution: { ...resolution, evidence: [] } })).toBeNull();
    expect(narrowDependencyObservation({ ...row, resolution: { ...resolution, productId: "lil" } })).toBeNull();
    expect(narrowDependencyObservation({ ...row, observedAt: 42 })).toBeNull();
  });
});

describe("createLiveDependenciesPort (mock exhaustive arms)", () => {
  it("consumes the current v0.6 wire vectors for both dependency methods", async () => {
    const vector = (name: string) => JSON.parse(readFileSync(new URL(`../../../../../schemas/bdl-queries/v0.6/examples/${name}.result.json`, import.meta.url), "utf8"));
    const lookup = vector("dependencies-lookup");
    const observations = vector("dependencies-listbyproduct");
    const port = createLiveDependenciesPort(fakeClient(async (request) => ok(
      request.method === "dependencies.lookup" ? lookup : observations,
    )));
    const matches = await port.lookup({ name: "liltoon" });
    expect(matches.kind).toBe("results");
    if (matches.kind === "results") expect(matches.matches).toHaveLength(lookup.result.matches.length);
    const clues = await port.listByProduct(observations.result.productId);
    expect(clues.kind).toBe("observations");
    if (clues.kind === "observations") expect(clues.observations).toHaveLength(observations.result.observations.length);
  });

  it("drives the lookup suggestion face: request shape, results view, honest empty set", async () => {
    const seen: DesktopGatewayRequestV1[] = [];
    const port = createLiveDependenciesPort(
      fakeClient(async (request) => {
        seen.push(request);
        return ok(LOOKUP_RESULT);
      }),
    );
    const view = await port.lookup({ name: "lilToon", depKind: null, limit: 50, offset: 0 });
    expect(view.kind).toBe("results");
    if (view.kind === "results") {
      expect(view.total).toBe(2);
      expect(view.matches).toHaveLength(2);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "dependencies.lookup",
      params: { name: "lilToon", depKind: null, limit: 50, offset: 0 },
    });

    // 诚实空集:total:0 = 无匹配名义,仍是 results 形态(渲染成「不存在
    // 该依赖」是消费面越线,协议明记)
    const empty = await createLiveDependenciesPort(
      fakeClient(async () =>
        ok({
          schemaVersion: "0.6",
          operation: "dependencies.lookup",
          result: { total: 0, matches: [] },
        }),
      ),
    ).lookup({ name: "com.lilxyzw.liltoon" });
    expect(empty).toEqual({ kind: "results", total: 0, matches: [] });
  });

  it("drives the observation face: tombstone productStatus rides honestly, unknown product is a not-found fact", async () => {
    const tombstone = structuredClone(LIST_BY_PRODUCT_RESULT) as typeof LIST_BY_PRODUCT_RESULT;
    (tombstone.result as { productStatus: string }).productStatus = "missing";
    const view = await createLiveDependenciesPort(
      fakeClient(async () => ok(tombstone)),
    ).listByProduct("booth:6584744");
    expect(view.kind).toBe("observations");
    if (view.kind === "observations") {
      expect(view.productStatus).toBe("missing");
      expect(view.observations).toHaveLength(3);
    }

    // W12/W17 判例:未知商品 = 应用面 not_found 码 → not-found 事实形态,
    // 不是错误文案
    const notFound = await createLiveDependenciesPort(
      fakeClient(async () => appError("vua.catalog.product_not_found")),
    ).listByProduct("booth:1111111");
    expect(notFound).toEqual({ kind: "not-found" });

    // 形态不齐的身份不可能存在:不投递必败请求
    const malformed = await createLiveDependenciesPort(
      fakeClient(async () => {
        throw new Error("must not be called");
      }),
    ).listByProduct("lil");
    expect(malformed).toEqual({ kind: "not-found" });
  });

  it("classifies application error codes onto the standing catalog word faces and falls back without guessing", async () => {
    const port = createLiveDependenciesPort(
      fakeClient(async () => appError("vua.catalog.invalid_params")),
    );
    expect(await port.lookup({ name: "x" })).toEqual({
      kind: "error",
      messageKey: "errors.catalog.invalidParams",
    });
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.catalog.store_failed")),
      ).listByProduct("booth:6584744"),
    ).toEqual({ kind: "error", messageKey: "errors.catalog.storeFailed" });
    // 词表外码回落 fallback,不猜测具体原因
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.catalog.something_else")),
      ).lookup({ name: "x" }),
    ).toEqual({ kind: "error", messageKey: "errors.catalog.fallback" });
  });

  it("answers honestly absent for the unwired provider, typed capability absence, transport failures, and uninterpretable envelopes (capability absence arm)", async () => {
    // 核心接线批前实现域未接线:provider 类型化 unknown_method → absent
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.provider.unknown_method")),
      ).lookup({ name: "lilToon" }),
    ).toEqual({ kind: "absent" });
    // 类型化能力缺席(category "unavailable",mock/真实 provider-host 缺席
    // 分支同三元)→ absent:能力缺席 = 控制不渲染,绝不渲染成失败页
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.catalog.unavailable", "unavailable")),
      ).lookup({ name: "lilToon" }),
    ).toEqual({ kind: "absent" });
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.catalog.unavailable", "unavailable")),
      ).listByProduct("booth:6584744"),
    ).toEqual({ kind: "absent" });
    // 同码不同 category(词表外码路径)→ fallback,不冒充缺席
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => appError("vua.catalog.unavailable", "validation")),
      ).lookup({ name: "lilToon" }),
    ).toEqual({ kind: "error", messageKey: "errors.catalog.fallback" });
    // 传输面拒绝(request_rejected)→ absent
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => rejected()),
      ).lookup({ name: "lilToon" }),
    ).toEqual({ kind: "absent" });
    // 传输异常 → absent
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => {
          throw new Error("transport");
        }),
      ).listByProduct("booth:6584744"),
    ).toEqual({ kind: "absent" });
    // 信封族常量/operation 词外 → absent(旧 v0.5 版本重放同拒)
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => ok({ ...LOOKUP_RESULT, schemaVersion: "0.5" })),
      ).lookup({ name: "lilToon" }),
    ).toEqual({ kind: "absent" });
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => ok({ some: "junk" })),
      ).listByProduct("booth:6584744"),
    ).toEqual({ kind: "absent" });
    // 半可信行:任一行收不齐 = 整份不可解释 → absent(无过滤面不静默丢行)
    const halfTrusted = structuredClone(LIST_BY_PRODUCT_RESULT) as typeof LIST_BY_PRODUCT_RESULT;
    (halfTrusted.result.observations as unknown[])[1] = { depKind: "shader" };
    expect(
      await createLiveDependenciesPort(
        fakeClient(async () => ok(halfTrusted)),
      ).listByProduct("booth:6584744"),
    ).toEqual({ kind: "absent" });
  });
});

describe("createUnavailableDependenciesPort + assemblies (absence arm, control-not-render precedent)", () => {
  it("stays honestly absent for empty/fixture assemblies (no fabricated clues or suggestions)", async () => {
    const port = createUnavailableDependenciesPort();
    expect(await port.lookup({ name: "lilToon" })).toEqual({ kind: "absent" });
    expect(await port.listByProduct("booth:6584744")).toEqual({ kind: "absent" });

    // 三装配同臂:empty(not-run)与 fixture(DEV 演示)不制造合成依赖事实
    expect(await emptyGateway().dependencies.lookup({ name: "x" })).toEqual({ kind: "absent" });
    expect(await emptyGateway().dependencies.listByProduct("booth:1")).toEqual({ kind: "absent" });
    expect(await fixtureGateway("demo-tasks").dependencies.lookup({ name: "x" })).toEqual({
      kind: "absent",
    });
    expect(await fixtureGateway("demo-tasks").dependencies.listByProduct("booth:1")).toEqual({
      kind: "absent",
    });
  });
});

/**
 * 四语词面钉(消费准备切片的词表基建):confidence 两档 + installSource 恰
 * advisory 规则 v1 发射的两值;vpm/unknown 在冻结闭集内但 v1 绝不发射,
 * 词表不留死行。可用性对骑既有 warehouse.availability 三行(零死重复)——
 * dependencies 投影的 availabilityStatus 三值必须都能在四表既有行命中
 * 非空词面。结构同步由 check:i18n-tables 编译期/脚本双守,此处钉词面
 * 闭集与逐表非空。
 */
describe("dependencies word faces across the four locale tables (clues-not-conclusions wording)", () => {
  const LOCALE_TABLES = [
    ["en", stringsEn],
    ["zh-CN", stringsZh],
    ["ja", stringsJa],
    ["ko", stringsKo],
  ] as const;

  const CONFIDENCE_KEYS = ["strong", "weak"] as const;
  const INSTALL_SOURCE_EMITTED = ["booth_page", "external_page"] as const;
  const AVAILABILITY_STATUSES = ["available", "unavailable", "unknown"] as const;

  it("holds exactly the two confidence tiers and the two emitted install sources in every table (no dead rows, no missing rows)", () => {
    for (const [locale, table] of LOCALE_TABLES) {
      expect(Object.keys(table.dependencies.confidence).sort(), locale).toEqual(
        [...CONFIDENCE_KEYS].sort(),
      );
      expect(Object.keys(table.dependencies.installSource).sort(), locale).toEqual(
        [...INSTALL_SOURCE_EMITTED].sort(),
      );
      for (const key of CONFIDENCE_KEYS) {
        expect(table.dependencies.confidence[key].length, locale).toBeGreaterThan(0);
      }
      for (const key of INSTALL_SOURCE_EMITTED) {
        expect(table.dependencies.installSource[key].length, locale).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the advisory copy in suggestion form, never a fact claim (clues-not-conclusions law on the word face)", () => {
    for (const [locale, table] of LOCALE_TABLES) {
      for (const key of INSTALL_SOURCE_EMITTED) {
        const row = table.dependencies.installSource[key];
        // 每行都是「建议安装来源」语气(en: Suggested…/zh: 建议…/ja: 推奨…/
        // ko: 추천…),绝不写成本体断言
        expect(/suggested|建议|推奨|추천/i.test(row), `${locale}:${key}`).toBe(true);
      }
    }
  });

  it("resolves the availability pair through the standing warehouse.availability rows in every table (zero dead duplicates)", () => {
    for (const [locale, table] of LOCALE_TABLES) {
      for (const status of AVAILABILITY_STATUSES) {
        const row = (table.warehouse.availability as Record<string, string>)[status];
        expect(typeof row === "string" && row.length > 0, `${locale}:${status}`).toBe(true);
      }
    }
  });
});
