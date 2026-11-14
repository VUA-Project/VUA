import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { format } from "./format.ts";
import { strings } from "./strings.zh-CN.ts";
import { fixtureStrings } from "./strings.fixtures.zh-CN.ts";
import { TERMS, termLabel, termSequence, type TermId } from "./terms.ts";
import { capabilityDetailKeys, capabilityStates } from "../gateway/types.ts";
import { workflowRunStates } from "../gateway/workflow.ts";

/**
 * BOARD #8:术语注解断言期望中文注解,termLabel/termSequence 经 current-table
 * 按宿主 navigator 选表——CI(en-US)解析到 en 表注解为空串而失败。测试显式
 * 固定语言表为 zh-CN,不依赖宿主 locale。
 */
vi.mock("./current-table.ts", async () => {
  const { strings: zhCN } = await import("./strings.zh-CN.ts");
  return { currentLocale: "zh-CN", currentStrings: zhCN };
});

test("format expands named params", () => {
  assert.equal(format(strings.deployer.summary.pending, { count: 2 }), "还差 2 项准备");
  assert.equal(format("{zone}的就绪状态", { zone: "游玩环境" }), "游玩环境的就绪状态");
});

test("format keeps placeholders for missing params (visible in dev)", () => {
  assert.equal(format("还差 {count} 项准备", {}), "还差 {count} 项准备");
});

test("term ids and term annotations stay in 1:1 parity", () => {
  assert.deepEqual(Object.keys(TERMS).sort(), Object.keys(strings.terms).sort());
});

test("suite pins the annotation table to zh-CN (BOARD #8 mock is in effect)", async () => {
  const pinned = await import("./current-table.ts");
  assert.equal(pinned.currentLocale, "zh-CN");
  assert.equal(pinned.currentStrings, strings);
});

test("termLabel uses local names without forcing English prefixes; brands stay unchanged", () => {
  assert.equal(termLabel("warehouse"), "素材");
  assert.equal(termLabel("release"), "成品");
  assert.equal(termLabel("amf"), "AMF");
  for (const id of Object.keys(TERMS) as TermId[]) {
    assert.equal(termLabel(id), strings.terms[id] || TERMS[id]);
  }
});

test("termSequence joins stage labels with arrows", () => {
  assert.equal(
    termSequence(["assembly", "production", "inspection"]),
    "装配 → 生产 → 检测",
  );
});

test("deployer zones and workshop conclusion keys match their model unions", () => {
  assert.deepEqual(Object.keys(strings.deployer.zones).sort(), ["create", "play"]);
  assert.deepEqual(Object.keys(strings.workshop.conclusion).sort(), [
    "blocked",
    "completed",
    "needsConfirmation",
    "notStarted",
    "running",
  ]);
  assert.deepEqual(Object.keys(strings.workshop.stageState).sort(), [
    "blocked",
    "completed",
    "current",
    "needsConfirmation",
    "pending",
  ]);
});

test("capability states and workflow stages match their model unions", () => {
  assert.deepEqual(
    Object.keys(strings.capability.states).sort(),
    [...capabilityStates].sort(),
  );
  assert.deepEqual(
    Object.keys(strings.capability.details).sort(),
    [...capabilityDetailKeys].sort(),
  );
  assert.deepEqual(
    Object.keys(strings.workflowStage).sort(),
    [...workflowRunStates].sort(),
  );
});

test("no template embeds a product term (terms must flow via placeholders)", () => {
  const walk = (value: unknown, path: string): string[] => {
    if (typeof value === "string") {
      return Object.values(TERMS).some((term) => value.includes(term)) ? [path] : [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, i) => walk(item, `${path}[${i}]`));
    }
    if (value !== null && typeof value === "object") {
      return Object.entries(value).flatMap(([key, item]) => walk(item, `${path}.${key}`));
    }
    return [];
  };
  assert.deepEqual(walk(strings, "strings"), []);
  assert.deepEqual(walk(fixtureStrings, "fixtureStrings"), []);
});

test("deployer group copy is keyed by CHECK_GROUPS registry ids in all five tables", async () => {
  // 2026-09-28 现场缺陷:词表键用驼峰 vrRuntime 而组注册表 id 是 snake_case
  // vr_runtime,查表恒 undefined → 组卡如实透传裸 id(标题/徽标/组结论全部
  // 缺席)。此测试把"键与组注册表 id 对应"的词表纪律钉进机器检查,五语同查。
  const { CHECK_GROUPS } = await import("../features/deployer/deployer-model.ts");
  const tableNames = ["en", "zh-CN", "zh-TW", "ja", "ko"] as const;
  const tables = await Promise.all(
    tableNames.map((name) => import(`./strings.${name}.ts`)),
  );
  for (const [index, table] of tables.entries()) {
    const groups = table.strings.deployer.groups as Readonly<Record<string, { title: string }>>;
    for (const group of CHECK_GROUPS) {
      const copy = groups[group.id];
      assert.ok(
        copy !== undefined,
        `deployer.groups missing CHECK_GROUPS id ${group.id} in the ${tableNames[index]} table`,
      );
      assert.ok(copy.title.length > 0);
    }
  }
});
