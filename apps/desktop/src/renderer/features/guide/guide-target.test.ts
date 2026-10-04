/**
 * 指南定位模型校验(首玩 B 切片):
 * - normalizeGuideTarget 回退矩阵(未知主题 → 开始页;未知分节 → 主题开头;
 *   形状垃圾 → 开始页);
 * - 命名定位注册表与部署页映射全部落在合法主题/分节闭集内;
 * - 加载查询解析(明确定位 > 无定位);
 * - 阅读位置持久化(存储往返、损坏值、词表漂移回退)。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GUIDE_FALLBACK_TARGET,
  GUIDE_SECTION_IDS,
  GUIDE_TARGETS,
  guideTargetForCheckId,
  guideTargetForComponent,
  loadGuideReading,
  normalizeGuideTarget,
  parseGuideTargetFromSearch,
  saveGuideReading,
  type GuideTarget,
} from "./guide-target.ts";
import { initialGuideTarget } from "../overlay/GuideOverlayView.tsx";

test("normalizeGuideTarget:合法主题+合法分节原样落位", () => {
  assert.deepEqual(normalizeGuideTarget({ topic: "guide-devices", section: "pico-usb" }), {
    topic: "guide-devices",
    section: "pico-usb",
  });
  assert.deepEqual(normalizeGuideTarget({ topic: "guide-start" }), { topic: "guide-start" });
});

test("normalizeGuideTarget:未知主题/形状垃圾 → 开始页;未知分节 → 主题开头", () => {
  assert.deepEqual(normalizeGuideTarget({ topic: "no-such-topic" }), GUIDE_FALLBACK_TARGET);
  assert.deepEqual(normalizeGuideTarget("guide-devices"), GUIDE_FALLBACK_TARGET);
  assert.deepEqual(normalizeGuideTarget(null), GUIDE_FALLBACK_TARGET);
  assert.deepEqual(normalizeGuideTarget(42), GUIDE_FALLBACK_TARGET);
  assert.deepEqual(normalizeGuideTarget({ topic: "guide-devices", section: "no-such-section" }), {
    topic: "guide-devices",
  });
  assert.deepEqual(normalizeGuideTarget({ topic: "guide-devices", section: 7 }), {
    topic: "guide-devices",
  });
});

test("命名定位注册表与部署页映射:全部落在合法主题/分节闭集内", () => {
  for (const [name, target] of Object.entries(GUIDE_TARGETS)) {
    assert.ok(target.topic in GUIDE_SECTION_IDS, `${name} 主题词表外`);
    assert.ok(
      target.section !== undefined && GUIDE_SECTION_IDS[target.topic].includes(target.section),
      `${name} 分节词表外`,
    );
  }
  for (const id of ["steam", "vrchat", "steamvr", "pico_runtime"]) {
    assert.ok(guideTargetForCheckId(id) !== null, `检查项 ${id} 缺映射`);
    assert.ok(guideTargetForComponent(id) !== null, `组件 ${id} 缺映射`);
  }
  assert.equal(guideTargetForCheckId("unity_editors"), null);
  assert.equal(guideTargetForComponent("unity_editor"), null);
});

test("加载查询解析:无定位参数 → null;有参数 → 词表校验后落位", () => {
  assert.equal(parseGuideTargetFromSearch("?surface=overlay-desktop&view=guide"), null);
  assert.deepEqual(
    parseGuideTargetFromSearch("?view=guide&guideTopic=guide-devices&guideSection=pico-wifi"),
    { topic: "guide-devices", section: "pico-wifi" },
  );
  // 词表外值安全回退开始页
  assert.deepEqual(parseGuideTargetFromSearch("?guideTopic=bogus&guideSection=x"), {
    topic: "guide-start",
  });
});

test("初始落点:明确定位(查询)> 上次阅读位置 > 开始页", () => {
  const stored: GuideTarget = { topic: "guide-devices", section: "eye-tracking" };
  assert.deepEqual(
    initialGuideTarget("?guideTopic=guide-devices&guideSection=pico-prepare", stored),
    { topic: "guide-devices", section: "pico-prepare" },
  );
  assert.deepEqual(initialGuideTarget("?view=guide", stored), stored);
  assert.deepEqual(initialGuideTarget("?view=guide", null), { topic: "guide-start" });
});

test("阅读位置持久化:存储往返一致;损坏值/词表漂移安全回退", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    assert.equal(loadGuideReading(), null);
    saveGuideReading({ topic: "guide-devices", section: "pico-usb" });
    assert.deepEqual(loadGuideReading(), { topic: "guide-devices", section: "pico-usb" });
    saveGuideReading({ topic: "guide-basics" });
    assert.deepEqual(loadGuideReading(), { topic: "guide-basics" });
    // 损坏 JSON → null
    store.set("vua-guide-reading", "{not json");
    assert.equal(loadGuideReading(), null);
    // 词表漂移(旧版本分节已删)→ 落回主题开头
    store.set("vua-guide-reading", JSON.stringify({ topic: "guide-devices", section: "gone" }));
    assert.deepEqual(loadGuideReading(), { topic: "guide-devices" });
    // 主题词表外 → 开始页
    store.set("vua-guide-reading", JSON.stringify({ topic: "guide-legacy" }));
    assert.deepEqual(loadGuideReading(), { topic: "guide-start" });
  } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});
