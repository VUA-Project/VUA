import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { languageFor } from "../src/page.js";
import { parseJson, type Json } from "../src/json.js";
import { validateShare } from "../src/validation.js";
import { app, publish, recipe, request, selection } from "./helpers.js";

for (const folder of ["amf-recipe/v0.4/share-examples", "amf-recipe/v0.5/share-examples", "amf-recipe/v0.6/share-examples", "selection-share/v0.1/examples"]) {
  test(`closed schema and semantic vectors: ${folder}`, () => {
    const directory = new URL(`../../../../schemas/${folder}/`, import.meta.url);
    for (const filename of readdirSync(directory)) {
      const value = parseJson(readFileSync(new URL(filename, directory), "utf8"));
      assert.equal(validateShare(value) !== null, filename.endsWith(".valid.json"), filename);
    }
  });
}

test("strict selection bounds and no unknown/local payload fields", () => {
  const invalid: unknown[] = [
    { ...selection() as object, title: "x".repeat(121) },
    { ...selection() as object, title: "\nHidden" },
    { ...selection() as object, products: new Array(65).fill({ productId: "1" }) },
    { ...selection() as object, products: [{ productId: 1 }] },
    { ...selection() as object, products: [{ productId: "01" }] },
    { ...selection() as object, products: [{ productId: "1", shopName: null }] },
    { ...selection() as object, products: [{ productId: "1", variantName: "a".repeat(513) }] },
    { ...selection() as object, products: [{ productId: "1", shopName: "a".repeat(513) }] },
    { ...selection() as object, products: [{ productId: "1", file: "/private/file" }] },
  ];
  for (const value of invalid) assert.equal(validateShare(value as Json), null);
  assert.ok(validateShare({ ...selection() as object, title: "猫".repeat(120) } as Json));
  assert.ok(validateShare({ ...selection() as object, products: [{ productId: "1", shopName: "😀".repeat(512) }] } as Json));
});

test("Recipe semantic checks refuse missing sources, mismatched products and broken references", () => {
  const original = recipe("0.5") as unknown as { recipe: { materials: { id: string }[]; avatar: { materialId: string } }; sources: Record<string, { boothProductId: string }> };
  const missing = structuredClone(original);
  delete missing.sources[missing.recipe.materials[0]!.id];
  assert.equal(validateShare(missing as unknown as Json), null);
  const mismatch = structuredClone(original);
  mismatch.sources[mismatch.recipe.materials[0]!.id]!.boothProductId = "9999999";
  assert.equal(validateShare(mismatch as unknown as Json), null);
  const broken = structuredClone(original);
  broken.recipe.avatar.materialId = "missing";
  assert.equal(validateShare(broken as unknown as Json), null);
});

for (const [accept, lang, title] of [["en-US", "en", "Materials"], ["ja-JP", "ja", "使用素材"], ["zh-CN", "zh-Hans", "素材清单"], ["zh-TW", "zh-Hant", "素材清單"], ["ko-KR", "ko", "사용 소재"]]) {
  test(`material page localization, CSP and escaping: ${lang}`, async () => {
    const handler = app();
    for (const declaration of [selection(), recipe("0.5")]) {
      const data = declaration as unknown as Record<string, unknown>;
      if (data.kind) data.title = "PLAYER_PRIVATE_TITLE_123";
      else (data.recipe as Record<string, unknown>).title = "PLAYER_PRIVATE_TITLE_123";
      if (data.kind) (data.products as Record<string, string>[])[0]!.shopName = '<img src=x onerror="alert(1)">&';
      else {
        const sources = data.sources as Record<string, Record<string, string>>;
        for (const source of Object.values(sources)) source.shopName = '<img src=x onerror="alert(1)">&';
      }
      const { code } = await publish(handler, declaration);
      const response = await handler(request(`/r/${code}`, "GET", undefined, { "accept-language": accept! }));
      const html = await response.text();
      assert.equal(response.headers.get("content-language"), lang);
      assert.equal(response.headers.get("vary"), "Accept-Language");
      assert.ok(html.includes(`<html lang="${lang}">`));
      assert.ok(html.includes(`<h1>${title}</h1>`));
      assert.ok(html.includes('<meta name="robots" content="noindex,nofollow,noarchive">'));
      assert.ok(html.includes(`<meta property="og:title" content="${title} · VUA">`));
      assert.ok(html.includes('<meta property="og:description" content="'));
      assert.ok(html.includes('<meta name="twitter:card" content="summary">'));
      assert.ok(!html.includes("PLAYER_PRIVATE_TITLE_123"));
      assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;"));
      assert.ok(!/<(?:script|img|link)\b|@import|url\(/iu.test(html));
      const css = /<style>(.*?)<\/style>/su.exec(html)![1]!;
      const csp = response.headers.get("content-security-policy")!;
      assert.ok(csp.includes("default-src 'none'"));
      assert.ok(csp.includes(`'sha256-${createHash("sha256").update(css).digest("base64")}'`));
      assert.ok(csp.includes("frame-ancestors 'none'"));
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    }
  });
}

test("language preferences honor quality, exclusions and Traditional Chinese regions", () => {
  assert.equal(languageFor("fr, ja;q=0.8, en;q=0.5"), "ja");
  assert.equal(languageFor("ja;q=0, ko;q=0.6"), "ko");
  assert.equal(languageFor("zh-HK"), "zh-Hant");
  assert.equal(languageFor("zh-Hant-US"), "zh-Hant");
  assert.equal(languageFor("zh-SG"), "zh-Hans");
  assert.equal(languageFor("de"), "en");
  assert.equal(languageFor("ja;q=invalid, en;q=1"), "en");
});
