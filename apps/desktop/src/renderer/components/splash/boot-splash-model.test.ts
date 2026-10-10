import assert from "node:assert/strict";
import { test } from "vitest";
import { SPLASH_FLATTENED_HOLD_MS, SPLASH_REVEAL_MS, splashVisibleMs } from "./boot-splash-model.ts";

test("startup stays through the reveal and loader, without extending flattened motion", () => {
  assert.ok(splashVisibleMs(false) > SPLASH_REVEAL_MS);
  assert.equal(splashVisibleMs(true), SPLASH_FLATTENED_HOLD_MS);
  assert.ok(splashVisibleMs(true) < splashVisibleMs(false));
});
