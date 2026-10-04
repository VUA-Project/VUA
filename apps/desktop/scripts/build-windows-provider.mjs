import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "win32") throw new Error("The Windows ZIP Provider must be built on Windows");
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// Link the Microsoft C runtime into this release executable so a new player's
// machine does not need a separate Visual C++ runtime before VUA can even start.
// An explicit target keeps this artifact separate from normal development builds.
const result = spawnSync("cargo", [
  "build", "--release", "--locked", "--target", "x86_64-pc-windows-msvc",
  "--config", 'target.x86_64-pc-windows-msvc.rustflags=["-C","target-feature=+crt-static"]',
  "-p", "vua-provider-host", "--bin", "vua-orchestrator-provider",
], { cwd: workspace, stdio: "inherit", shell: false, windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Windows Provider build failed (${result.status ?? result.signal})`);
