import { expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGuidePlacement, writeGuidePlacement } from "./game-guide-placement-store.js";

it("restores a local layout preference and ignores unsupported or corrupt files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vua-guide-placement-"));
  const file = path.join(directory, "placement.json");
  try {
    expect(readGuidePlacement(file)).toBeNull();
    expect(writeGuidePlacement(file, { x: 0.25, y: 0.75 })).toBe(true);
    expect(readGuidePlacement(file)).toEqual({ x: 0.25, y: 0.75 });
    for (const invalid of ["{", '{"schemaVersion":2,"x":0.2,"y":0.5}', '{"schemaVersion":1,"x":-1,"y":0.5}', '{"schemaVersion":1,"x":0.2,"y":2}', '{"schemaVersion":1,"x":0.2,"y":0.5,"pid":1}']) {
      fs.writeFileSync(file, invalid);
      expect(readGuidePlacement(file)).toBeNull();
    }
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.tmp`, { force: true });
    fs.rmdirSync(directory);
  }
});
