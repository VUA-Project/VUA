import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { GUIDE_SCREENSHOTS, guideMediaForSection } from "./guide-media-manifest.ts";
import { encyclopediaCopy } from "../../i18n/encyclopedia-copy.ts";
import { guideAvatarCopy } from "../../i18n/guide-avatar-copy.ts";
import { guideEacCopy } from "../../i18n/guide-eac-copy.ts";
import { guidePage } from "./guide-content.ts";
import { GUIDE_TARGETS } from "./guide-target.ts";
import { GUIDE_ARTICLES, GUIDE_TASKS, guideArticleForTarget, normalizeGuideSearch, searchGuideArticles } from "./guide-catalog.ts";

test("catalog gives every legacy target an article and keeps new sources explicit", () => {
  assert.equal(new Set(GUIDE_ARTICLES.map(article => article.id)).size, GUIDE_ARTICLES.length);
  for (const target of Object.values(GUIDE_TARGETS)) assert.ok(guideArticleForTarget(target), `Missing ${target.topic}/${target.section}`);
  const avatars = GUIDE_ARTICLES.filter(article => article.target.topic === "guide-avatars");
  assert.equal(avatars.length, 8);
  const eacArticles = GUIDE_ARTICLES.filter(article => article.id.startsWith("guide-start/eac-"));
  assert.equal(eacArticles.length, 6);
  for (const article of [...avatars, ...eacArticles]) {
    assert.equal(article.reviewStatus, "source-checked");
    assert.ok(article.sourceRefs.length > 0, `${article.id} has no sources`);
    for (const source of article.sourceRefs) {
      assert.equal(new URL(source.url).protocol, "https:");
      assert.ok(source.publisher.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt ?? ""));
    }
  }
  for (const article of eacArticles) {
    assert.equal(article.kind, "troubleshooting");
    assert.equal(article.reviewedAt, "2026-11-14");
  }
});

test("search finds actual questions without inventing a result for unknown terms", () => {
  assert.equal(normalizeGuideSearch("  Ｎｅｗ　User  "), "new user");
  assert.ok(searchGuideArticles({ query: "New User" }).some(article => article.id === "guide-creator/upload-eligibility"));
  assert.ok(searchGuideArticles({ query: "别人看不到" }).some(article => article.id === "guide-avatars/visibility"));
  assert.ok(searchGuideArticles({ query: "变粉" }).some(article => article.id === "guide-avatars/pink-materials"));
  assert.ok(searchGuideArticles({ query: "FPS" }).some(article => article.id === "guide-avatars/performance"));
  assert.ok(searchGuideArticles({ query: "Shield" }).some(article => article.id === "guide-safety/trust"));
  assert.ok(searchGuideArticles({ query: "30005" }).some(article => article.id === "guide-start/eac-30005-occupied"));
  assert.ok(searchGuideArticles({ query: "1275" }).some(article => article.id === "guide-start/eac-1275-driver-blocked"));
  assert.ok(searchGuideArticles({ query: "30004" }).some(article => article.id === "guide-start/eac-untrusted-system-file"));
  assert.ok(searchGuideArticles({ query: "杀毒" }).some(article => article.id === "guide-start/eac-not-installed"));
  assert.equal(searchGuideArticles({ query: "term-that-has-no-answer" }).length, 0);
  const filtered = searchGuideArticles({ query: "衣服", topic: "guide-avatars", kind: "troubleshooting" });
  assert.ok(filtered.length > 0 && filtered.every(article => article.target.topic === "guide-avatars" && article.kind === "troubleshooting"));
  assert.deepEqual(searchGuideArticles({}), GUIDE_ARTICLES);
});

test("search covers the full article body, not only its summary", () => {
  const source = GUIDE_ARTICLES.find(article => article.target.topic === "guide-avatars");
  assert.ok(source);
  const article = {
    ...source,
    title: "A different question",
    summary: "A different summary",
    aliases: [],
    body: "The answer contains sole-full-body-token in its complete text.",
  };
  assert.deepEqual(searchGuideArticles({ query: "sole-full-body-token" }, [article]), [article]);
  assert.equal(searchGuideArticles({ query: "sole-full-body-token" }, [{ ...article, body: article.summary }]).length, 0);
});

test("new content is separate from the legacy language tables and has five complete locale sets", () => {
  for (const [locale, page] of Object.entries(guideAvatarCopy)) {
    assert.deepEqual(page.sections.map(section => section.id), guideAvatarCopy.en.sections.map(section => section.id), locale);
    assert.ok(page.title.length > 0 && page.intro.length > 0);
    for (const section of page.sections) {
      assert.ok(section.title.length > 0 && section.paragraphs.length >= 2);
      assert.ok(section.paragraphs.every(paragraph => paragraph.length > 0));
    }
  }
  for (const [locale, sections] of Object.entries(guideEacCopy)) {
    assert.deepEqual(sections.map(section => section.id), guideEacCopy.en.map(section => section.id), locale);
    assert.equal(sections.length, 6, locale);
    for (const section of sections) {
      assert.ok(section.title.length > 0 && section.paragraphs.length === 2, `${locale}/${section.id}`);
      assert.ok(section.paragraphs.every(paragraph => paragraph.length > 0), `${locale}/${section.id}`);
    }
  }
  assert.equal(guidePage("guide-vua").sections[0]?.id, "first-run-language");
  assert.equal(GUIDE_TASKS.length, 6);
  for (const copy of Object.values(encyclopediaCopy)) {
    for (const task of GUIDE_TASKS) assert.ok(copy.tasks[task.id].title.length > 0 && copy.tasks[task.id].body.length > 0);
    assert.equal(copy.firstRun.id, "first-run-language");
    assert.equal(copy.firstRun.paragraphs.length, 2);
  }
});

test("real VUA media is local, described and separated from unavailable game captures", () => {
  const sourceBuild = JSON.parse(readFileSync(path.resolve("public/guide/vua/source-build.json"), "utf8"));
  for (const meta of Object.values(GUIDE_SCREENSHOTS)) {
    const file = path.resolve("public", meta.src.slice(2));
    assert.ok(existsSync(file) && statSync(file).isFile() && statSync(file).size > 0, meta.src);
    const image = readFileSync(file);
    assert.equal(image.readUInt32BE(16), meta.width, `${meta.src} width`);
    assert.equal(image.readUInt32BE(20), meta.height, `${meta.src} height`);
    assert.match(meta.commit, /^[a-f0-9]{40}$/);
    assert.ok(meta.commit.startsWith(sourceBuild.commit));
    assert.equal(meta.dirty, sourceBuild.dirty);
    assert.equal(meta.sourceMode, sourceBuild.captureMode);
    assert.ok(Date.parse(meta.capturedAt) >= Date.parse(sourceBuild.builtAt));
    assert.ok(meta.privacy.length > 0);
    assert.equal(meta.license, "Apache-2.0");
  }
  assert.match(GUIDE_SCREENSHOTS["vua-avatar-preparation"].privacy, /Cropped/);
  assert.equal(guideMediaForSection("guide-vua", "first-run-language"), null,
    "The old language-choice capture must not illustrate the new notice");
  assert.equal(guideMediaForSection("guide-avatars", "visibility"), null);
});
