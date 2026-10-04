import { build, Platform, Arch } from "electron-builder";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("Build and verify this Windows preview on Windows");
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(desktop, "out");
await mkdir(output, { recursive: true });
// Repeated builds must not replace an unpacked ASAR held open by a running app
// or a file scanner. Each build stages separately; publish only its completed ZIP.
const staging = await mkdtemp(path.join(output, ".package-"));
try {
  const artifacts = await build({
    projectDir: desktop,
    targets: Platform.WINDOWS.createTarget(["zip"], Arch.x64),
    publish: "never",
    config: { extends: path.join(desktop, "electron-builder.yml"), directories: { output: staging } },
  });
  const zips = artifacts.filter((artifact) => artifact.endsWith("-preview.zip"));
  if (zips.length !== 1) throw new Error(`Expected one ZIP, got ${zips.length}`);
  const artifact = path.join(output, path.basename(zips[0]));
  const pending = `${artifact}.pending`;
  await copyFile(zips[0], pending);
  await rename(pending, artifact);
  console.log(`Unsigned ZIP preview: ${artifact}`);
} finally {
  // Delete only the temporary directory created by this invocation. Locked files
  // may be kept for later cleanup; they cannot block the next isolated build.
  if (path.dirname(staging) !== output || !path.basename(staging).startsWith(".package-")) {
    throw new Error("Refusing cleanup outside the packaging staging directory");
  }
  await rm(staging, { recursive: true, force: true, maxRetries: 2 }).catch(() => {
    console.warn(`Packaging temporary files remain locked: ${staging}`);
  });
}
