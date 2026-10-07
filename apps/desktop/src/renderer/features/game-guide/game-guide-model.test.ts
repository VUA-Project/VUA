/**
 * 游戏引导模型回归(三类引导 §4 手动版:步表/进度/透明度)。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  GAME_GUIDE_DEFAULT_FOLLOWING,
  GAME_GUIDE_DEFAULT_OPACITY,
  GAME_GUIDE_STEPS,
  decideGameGuideStep,
  gameGuideComplete,
  normalizeGameGuideOpacity,
  normalizeGameGuideStep,
  parseGameGuideFollowing,
  parseGameGuidePresentation,
  parseGameGuideProgress,
  restartGameGuide,
  serializeGameGuideFollowing,
  serializeGameGuidePresentation,
  serializeGameGuideProgress,
} from "./game-guide-model.ts";

test("步表:五步固定顺序(操作/音频/个人空间/不受信任 URL/教程世界)", () => {
  assert.deepEqual(GAME_GUIDE_STEPS, [
    "controls",
    "audio",
    "personalSpace",
    "untrustedUrls",
    "worlds",
  ]);
});

test("normalizeStep:越界/非数钳回;normalizeOpacity:钳 0.2–1", () => {
  assert.equal(normalizeGameGuideStep(0), 0);
  assert.equal(normalizeGameGuideStep(4), 4);
  assert.equal(normalizeGameGuideStep(99), 4);
  assert.equal(normalizeGameGuideStep(-3), 0);
  assert.equal(normalizeGameGuideStep(Number.NaN), 0);
  assert.equal(normalizeGameGuideOpacity(0.5), 0.5);
  assert.equal(normalizeGameGuideOpacity(0.05), 0.2);
  assert.equal(normalizeGameGuideOpacity(2), 1);
  assert.equal(normalizeGameGuideOpacity(Number.NaN), GAME_GUIDE_DEFAULT_OPACITY);
});

test("进度解析:合法载荷原样;决定词表外/非法值/版本不符/形状垃圾 → null", () => {
  assert.deepEqual(parseGameGuideProgress('{"v":1,"current":2,"decided":{"controls":"confirmed"}}'), {
    v: 1,
    current: 2,
    decided: { controls: "confirmed" },
  });
  assert.equal(parseGameGuideProgress(null), null);
  assert.equal(parseGameGuideProgress("not-json"), null);
  assert.equal(parseGameGuideProgress('{"v":2,"current":0,"decided":{}}'), null);
  assert.equal(parseGameGuideProgress('{"v":1,"current":"0","decided":{}}'), null);
  assert.equal(parseGameGuideProgress('{"v":1,"current":0,"decided":{"madeUp":"confirmed"}}'), null);
  assert.equal(parseGameGuideProgress('{"v":1,"current":0,"decided":{"controls":"maybe"}}'), null);
  assert.equal(parseGameGuideProgress('{"v":1,"current":0,"decided":[]}'), null);
  assert.equal(parseGameGuideProgress("[1]"), null);
});

test("决定并推进:确认/跳过都推进;全部决定后完成;重开清空", () => {
  let progress = restartGameGuide();
  assert.equal(progress.current, 0);
  progress = decideGameGuideStep(progress, "confirmed");
  assert.deepEqual(progress.decided, { controls: "confirmed" });
  assert.equal(progress.current, 1);
  progress = decideGameGuideStep(progress, "skipped");
  progress = decideGameGuideStep(progress, "confirmed");
  progress = decideGameGuideStep(progress, "skipped");
  assert.equal(gameGuideComplete(progress), false, "四步决定后还差 worlds");
  progress = decideGameGuideStep(progress, "confirmed");
  assert.equal(gameGuideComplete(progress), true);
  assert.equal(progress.current, 4, "全部决定后停在最后一步");
  // 完成态重复决定不越界
  progress = decideGameGuideStep(progress, "confirmed");
  assert.equal(progress.current, 4);
  const restarted = restartGameGuide();
  assert.equal(restarted.current, 0);
  assert.deepEqual(restarted.decided, {});
});

test("进度序列化与解析对偶", () => {
  const progress = { v: 1 as const, current: 3, decided: { audio: "skipped" as const } };
  assert.deepEqual(parseGameGuideProgress(serializeGameGuideProgress(progress)), progress);
});

test("呈现偏好解析:透明度钳制;损坏/版本不符 → null", () => {
  assert.deepEqual(parseGameGuidePresentation('{"v":1,"opacity":0.75}'), { v: 1, opacity: 0.75 });
  assert.deepEqual(parseGameGuidePresentation('{"v":1,"opacity":0.01}'), { v: 1, opacity: 0.2 });
  assert.equal(parseGameGuidePresentation(null), null);
  assert.equal(parseGameGuidePresentation('{"v":1,"opacity":"0.5"}'), null);
  assert.equal(parseGameGuidePresentation('{"v":2,"opacity":0.5}'), null);
  const presentation = { v: 1 as const, opacity: 0.6 };
  assert.deepEqual(parseGameGuidePresentation(serializeGameGuidePresentation(presentation)), presentation);
});

test("跟随偏好解析:合法载荷原样;垃圾/版本不符/非布尔 → null;缺省 true", () => {
  assert.deepEqual(parseGameGuideFollowing('{"v":1,"enabled":false}'), { v: 1, enabled: false });
  assert.deepEqual(parseGameGuideFollowing('{"v":1,"enabled":true}'), { v: 1, enabled: true });
  assert.equal(parseGameGuideFollowing(null), null);
  assert.equal(parseGameGuideFollowing("not-json"), null);
  assert.equal(parseGameGuideFollowing('{"v":2,"enabled":true}'), null);
  assert.equal(parseGameGuideFollowing('{"v":1,"enabled":"yes"}'), null);
  assert.equal(parseGameGuideFollowing('{"v":1}'), null);
  assert.equal(parseGameGuideFollowing("[true]"), null);
  assert.equal(GAME_GUIDE_DEFAULT_FOLLOWING, true);
  const following = { v: 1 as const, enabled: false };
  assert.deepEqual(parseGameGuideFollowing(serializeGameGuideFollowing(following)), following);
});
