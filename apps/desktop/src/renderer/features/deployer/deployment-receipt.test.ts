import { describe, expect, it } from "vitest";
import { readDeploymentReceipt } from "./deployment-receipt.ts";

const receipt = { v: 1, taskId: "accepted-installation", startedAt: 1_791_417_600_000,
  intent: { purposes: ["pico_pcvr"], editorRoot: "C:\\Editors", picoRegion: "other" } };

describe("deployment task return", () => {
  it("restores only the accepted task and selected intent, without an executable plan", () => {
    expect(readDeploymentReceipt(JSON.stringify(receipt))).toEqual(receipt);
    expect(readDeploymentReceipt(JSON.stringify({ ...receipt, confirmedDigest: "a".repeat(64) }))).toBeNull();
    expect(readDeploymentReceipt(JSON.stringify({ ...receipt, prerequisitesReady: true }))).toBeNull();
  });
  it("refuses corrupted bookmarks, unsupported regions and command-bearing intent", () => {
    for (const raw of [null, "broken", "[]", JSON.stringify({ ...receipt, taskId: "" }),
      JSON.stringify({ ...receipt, taskId: "task\n" }), JSON.stringify({ ...receipt, startedAt: -1 }),
      JSON.stringify({ ...receipt, intent: { ...receipt.intent, picoRegion: "unknown" } }),
      JSON.stringify({ ...receipt, intent: { ...receipt.intent, args: ["/S"] } })]) {
      expect(readDeploymentReceipt(raw)).toBeNull();
    }
  });
});
