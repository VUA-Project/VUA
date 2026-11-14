import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, normalizeCode, parseJson, shareCode, type Json } from "../src/json.js";

test("RFC 8785 primitive serialization and UTF-16 key ordering", () => {
  assert.equal(canonicalize(parseJson(String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001,-0],"string":"€$\u000f\nA'B\"\\\\\"/"}`)),
    String.raw`{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0],"string":"€$\u000f\nA'B\"\\\\\"/"}`);
  assert.equal(canonicalize({ "2": true, "10": false }), '{"10":false,"2":true}');
  assert.equal(canonicalize({ "\uE000": 1, "😀": 2, "\r": 3, "€": 4 }), '{"\\r":3,"€":4,"😀":2,"":1}');
  assert.notEqual(canonicalize("é"), canonicalize("e\u0301"));
});

test("fixed cross-client vectors include Recipe v0.4, v0.5, v0.6 and both selections", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../test-vectors/codes.json", import.meta.url), "utf8")) as { declaration: Json; canonical: string; code: string }[];
  assert.equal(vectors.length, 5);
  for (const vector of vectors) {
    assert.equal(canonicalize(vector.declaration), vector.canonical);
    assert.equal(shareCode(vector.canonical), vector.code);
    assert.equal(normalizeCode(vector.code.toLowerCase()), vector.code);
  }
});

test("strict bounded JSON refuses duplicate keys, invalid Unicode and non-finite numbers", () => {
  for (const value of ['{"a":1,"\\u0061":2}', '"\\ud800"', '{"\\udfff":0}', "1e400", "01", "[1,]", '{"a":1,}', "true false", "[", '"\\q"']) assert.throws(() => parseJson(value), value);
  assert.throws(() => parseJson("[".repeat(32) + "0" + "]".repeat(32)));
  assert.doesNotThrow(() => parseJson("[".repeat(31) + "0" + "]".repeat(31)));
  assert.throws(() => canonicalize(NaN));
  assert.throws(() => canonicalize("\ud800"));
  assert.equal(canonicalize(parseJson('{"__proto__":{"x":1}}')), '{"__proto__":{"x":1}}');
  assert.equal(normalizeCode("OOOOOOOOOOOO"), null);
  assert.equal(normalizeCode("12345678901U"), null);
  assert.equal(normalizeCode("ſ12345678901"), null);
  assert.equal(normalizeCode("../123456789"), null);
});
