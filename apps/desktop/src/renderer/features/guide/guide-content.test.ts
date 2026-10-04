/**
 * guide-content 模型校验(G6 → 2026-09-26 覆盖层宿主裁决):
 * - 六主题结构:五个教程支撑主题的教程在内容包内(注入真实内容包 JSON
 *   校验),阅读型 guide-vua 无教程支撑(不伪造内容包行);
 * - strings 引用的媒体 id 全部有登记资产;
 * - 未登记媒体 id 解析为 null(诚实缺省)。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { contentPack } from "../../app/tutorial-content-pack.ts";
import { strings } from "../../i18n/index.ts";
import {
  GUIDE_MEDIA,
  GUIDE_PAGE_TUTORIAL,
  GUIDE_TOPIC_COPY_KEY,
  GUIDE_TOPIC_IDS,
  GUIDE_TUTORIAL_TOPIC_IDS,
  resolveGuideMedia,
  validateGuideContent,
} from "./guide-content.ts";

test("六主题结构校验通过(真实内容包)", () => {
  assert.doesNotThrow(() => validateGuideContent(contentPack));
});

test("教程支撑主题 id 与内容包教程同名且在内容包内;guide-vua 无教程支撑", () => {
  const pack = contentPack;
  const ids = new Set(pack.tutorials.map((t) => t.id));
  for (const topic of GUIDE_TUTORIAL_TOPIC_IDS) {
    assert.equal(GUIDE_PAGE_TUTORIAL[topic], topic);
    assert.ok(ids.has(topic), `内容包缺教程 ${topic}`);
  }
  // 阅读型主题:不伪造内容包行——内容包内不存在 guide-vua 教程
  assert.ok(!ids.has("guide-vua"));
  assert.equal(GUIDE_TOPIC_IDS.length, 6);
  assert.equal(GUIDE_TOPIC_IDS[5], "guide-vua");
});

test("每个主题 id 都映射到 strings.guide.pages 的合法键", () => {
  for (const topic of GUIDE_TOPIC_IDS) {
    const key = GUIDE_TOPIC_COPY_KEY[topic];
    assert.ok(key in strings.guide.pages, `${topic} copy key ${key}`);
  }
  assert.equal(GUIDE_TOPIC_COPY_KEY["guide-vua"], "vua");
});

test("媒体解析:登记 id 有资产,未登记 id 为 null", () => {
  for (const id of Object.keys(GUIDE_MEDIA)) {
    const media = resolveGuideMedia(id);
    assert.ok(media && media.src.length > 0 && media.alt.length > 0, `${id} 资产缺省`);
  }
  assert.equal(resolveGuideMedia("no-such-media"), null);
});

test("媒体 src 一律相对路径(file:// 打包形态下绝对路径必破图,B 切片真机实证)", () => {
  for (const [id, media] of Object.entries(GUIDE_MEDIA)) {
    assert.ok(media.src.startsWith("./guide/"), `${id} src 必须是 ./guide/ 相对路径`);
  }
});
