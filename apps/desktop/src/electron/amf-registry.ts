import fs from "node:fs";
import path from "node:path";

export interface AmfRegistration {
  readonly schemaVersion: "0.1";
  readonly enabled: boolean;
  readonly dataLayout: "legacy" | "isolated";
}

/** Module selection belongs to the host. Only file presence is used for the
 * legacy opt-in; the host never opens the BDL database. */
export class AmfRegistry {
  readonly file: string;
  readonly registration: AmfRegistration;
  readonly invalid: boolean;

  constructor(readonly userData: string) {
    this.file = path.join(userData, "modules", "amf.json");
    this.invalid = false;
    if (fs.existsSync(this.file)) {
      try {
        const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (!isRegistration(value)) throw new Error("Invalid AMF registration");
        this.registration = value;
      } catch {
        this.invalid = true;
        this.registration = { schemaVersion: "0.1", enabled: true, dataLayout: "legacy" };
      }
    } else {
      const legacy = fs.existsSync(path.join(userData, "bdl", "bdl.db"));
      this.registration = { schemaVersion: "0.1", enabled: legacy, dataLayout: legacy ? "legacy" : "isolated" };
    }
  }

  dataRoot(): string {
    return this.registration.dataLayout === "legacy" ? this.userData : path.join(this.userData, "modules", "amf", "data");
  }

  save(enabled: boolean): void {
    if (this.invalid) throw new Error("Invalid AMF registration; existing file retained");
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.pending`;
    fs.writeFileSync(temporary, JSON.stringify({ ...this.registration, enabled }), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}

function isRegistration(value: unknown): value is AmfRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && row.schemaVersion === "0.1" && typeof row.enabled === "boolean"
    && (row.dataLayout === "legacy" || row.dataLayout === "isolated");
}
