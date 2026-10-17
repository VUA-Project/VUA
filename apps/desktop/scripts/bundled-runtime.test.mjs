import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBundledRuntime } from "./bundled-runtime.mjs";
test("embedded standalone-code templates do not require a shipped module",()=>{
  assert.doesNotThrow(()=>assertBundledRuntime('const template = "require(\\\"ajv/dist/runtime/validation_error\\\")"; require("node:crypto");',"main"));
});
test("actual dependencies remain strictly bounded",()=>{
  assert.throws(()=>assertBundledRuntime('require /* comment */ ("ajv");',"main"),/unexpected unbundled/);
  assert.throws(()=>assertBundledRuntime('requ\\u0069re("not-bundled");',"main"),/unexpected unbundled/);
  assert.throws(()=>assertBundledRuntime('__require("not-bundled");',"main"),/unexpected unbundled/);
  assert.throws(()=>assertBundledRuntime('module.require("not-bundled");',"main"),/unexpected unbundled/);
  assert.throws(()=>assertBundledRuntime('require(variable);',"main"),/dynamic/);
});
test("sandbox preload can only load Electron",()=>{
  assert.doesNotThrow(()=>assertBundledRuntime('require("electron");',"preload"));
  assert.throws(()=>assertBundledRuntime('require("node:fs");',"preload"),/unexpected unbundled/);
});
