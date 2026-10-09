import fs from "node:fs";
import path from "node:path";
import type { GuideRelativePlacement } from "./game-guide-follow.js";

/** Local layout preference only; no process, monitor or game identifiers. */
export function readGuidePlacement(file: string): GuideRelativePlacement | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || record.schemaVersion !== 1
      || typeof record.x !== "number" || !Number.isFinite(record.x) || record.x < 0 || record.x > 1
      || typeof record.y !== "number" || !Number.isFinite(record.y) || record.y < 0 || record.y > 1) return null;
    return { x: record.x, y: record.y };
  } catch { return null; }
}

export function writeGuidePlacement(file: string, placement: GuideRelativePlacement): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, ...placement }), "utf8");
    fs.renameSync(temporary, file);
    return true;
  } catch { return false; }
}
