import assert from "node:assert/strict";
import { test } from "vitest";
import { accountGuideDestination } from "./account-guide.js";

test("account-guide handoff accepts a public guide ID, never a URL or inherited key", () => {
  assert.equal(accountGuideDestination("vrchat"), "https://vrchat.com/home/register");
  for (const value of ["https://vrchat.com/home/register", "file:///C:/secret", "constructor", "__proto__", "STEAM", { guide: "steam" }, null]) {
    assert.equal(accountGuideDestination(value), null);
  }
});
