import fs from "node:fs";
import path from "node:path";

export interface AmfRegistration {
  readonly schemaVersion: "0.1";
  readonly enabled: boolean;
  readonly dataLayout: "legacy" | "isolated";
}

/** Module selection belongs to the host. Legacy file presence selects only
 * the retained data layout, never activation; the host does not open BDL. */
export class AmfRegistry {
  readonly file: string;
  readonly registration: AmfRegistration;
  readonly invalid: boolean;
  readonly needsRegistration: boolean;

  constructor(readonly userData: string) {
    this.file = path.join(userData, "modules", "amf.json");
    this.invalid = false;
    this.needsRegistration = !fs.existsSync(this.file);
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
      const existingProfile = legacy || fs.existsSync(path.join(userData, "host", "tasks.db"))
        || fs.existsSync(path.join(userData, "orchestrator", "provider.db"))
        || fs.existsSync(path.join(userData, "modules", "amf", "data"));
      this.registration = { schemaVersion: "0.1", enabled: !existingProfile, dataLayout: legacy ? "legacy" : "isolated" };
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
