import fs from "node:fs";
import path from "node:path";

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** Requests the AI queued, kept in VUA's data folder so they still wait after a restart. They hold
 * the reviewed facts shown to the player (local paths and material names), never the pairing key. */
export function aiRequestStore(directory: string) {
  const target = path.join(directory, "ai-requests.json");
  return {
    loadRequests(): unknown {
      if (!fs.existsSync(target)) return null;
      const value: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
      return value && typeof value === "object" && "approvals" in value ? value.approvals : null;
    },
    saveRequests(approvals: readonly unknown[]): void {
      fs.mkdirSync(directory, { recursive: true });
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: "0.1", approvals }), { mode: 0o600 });
      fs.renameSync(temp, target);
    },
  };
}

/** No plaintext fallback. Without OS encryption pairing lasts only for this launch. */
export function aiConnectionStore(directory: string, secrets: SecretStorage) {
  const target = path.join(directory, "ai-connection.json");
  return {
    load(): { enabled: boolean; token: string | null } {
      try {
        if (!secrets.isEncryptionAvailable()) return { enabled: false, token: null };
        const value: unknown = JSON.parse(fs.readFileSync(target, "utf8"));
        if (!value || typeof value !== "object" || !("encryptedToken" in value) || !("enabled" in value)
          || typeof value.encryptedToken !== "string" || value.encryptedToken.length > 4096 || typeof value.enabled !== "boolean") throw new Error("invalid_store");
        const token = secrets.decryptString(Buffer.from(value.encryptedToken, "base64"));
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid_pairing");
        return { enabled: value.enabled, token };
      } catch { return { enabled: false, token: null }; }
    },
    save(enabled: boolean, token: string): void {
      if (!secrets.isEncryptionAvailable()) return;
      fs.mkdirSync(directory, { recursive: true });
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: "0.1", enabled, encryptedToken: secrets.encryptString(token).toString("base64") }), { mode: 0o600 });
      fs.renameSync(temp, target);
    },
  };
}
