import { describe, expect, it } from "vitest";
import { canonicalShareJson, isShareImageOptions, normalizeShareCode, parseShareJson, shareCodeFromLink } from "./share-links-v01.js";
describe("share links v0.1", () => {
  it("accepts exactly the fixed HTTPS host or the share protocol and normalizes ASCII case", () => {
    const code="3P3J7H0EGWP1", host="https://ph-r.com";
    for (const value of [`${host}/r/${code}`,`${host}/r/${code.toLowerCase()}`,`vua://share/${code}`]) expect(shareCodeFromLink(value,host)).toBe(code);
    for (const value of [`http://ph-r.com/r/${code}`,`https://user@ph-r.com/r/${code}`,`https://example.test/r/${code}`,`vua://share/${code}?x=1`,`vua://share/${code}/`,`vua://other/${code}`,`vua://share/${code}#x`,`vua://share:123/${code}`,`vua://share/%33P3J7H0EGWP1`]) expect(shareCodeFromLink(value,host)).toBeNull();
    expect(normalizeShareCode("OOOOOOOOOOOO")).toBeNull();
  });
  it("requires a fresh explicit public opt-in for documents", () => {
    const plain={runId:"run-1",format:"png",frameIndex:59}; expect(isShareImageOptions(plain)).toBe(true);
    for (const bad of [{...plain,frameIndex:60},{...plain,format:"mp4"},{...plain,token:"secret"},{...plain,document:{}},{...plain,publicConfirmed:true}]) expect(isShareImageOptions(bad)).toBe(false);
  });
  it("canonicalizes numeric-looking names and refuses ambiguous or invalid JSON", () => {
    expect(canonicalShareJson({"2":"two","10":"ten",a:-0})).toBe('{"10":"ten","2":"two","a":0}');
    expect(parseShareJson('{"a":[1,{"b":2}]}')).toEqual({a:[1,{b:2}]});
    for (const bad of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":"\\ud800"}','[1e999]']) expect(() => parseShareJson(bad)).toThrow();
  });
});
