import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiConnectionStore } from "./ai-connection-store.js";
describe("AI pairing storage", () => {
  it("retains pairing only through the OS secret interface, with no plaintext fallback", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vua-ai-test-"));
    const token = "t".repeat(43);
    const secrets = { isEncryptionAvailable: () => true, encryptString: () => Buffer.from("encrypted-test"), decryptString: () => token };
    try {
      const store = aiConnectionStore(directory, secrets);
      expect(store.load()).toEqual({ enabled: false, token: null });
      store.save(true, token);
      expect(fs.readFileSync(path.join(directory, "ai-connection.json"), "utf8")).not.toContain(token);
      expect(store.load()).toEqual({ enabled: true, token });
      const ephemeral = aiConnectionStore(directory, { ...secrets, isEncryptionAvailable: () => false });
      expect(ephemeral.load()).toEqual({ enabled: false, token: null });
      ephemeral.save(false, "x".repeat(43));
      expect(store.load()).toEqual({ enabled: true, token });
      fs.writeFileSync(path.join(directory, "ai-connection.json"), "broken");
      expect(store.load()).toEqual({ enabled: false, token: null });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
