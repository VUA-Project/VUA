import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const host = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider" + suffix);
const amf = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider" + suffix);
if (!fs.existsSync(host) || !fs.existsSync(amf)) throw new Error("Build both native providers before running module isolation tests");
const result = spawnSync(process.execPath, [path.resolve(desktop, "node_modules/vitest/vitest.mjs"), "run", "src/electron/amf-isolation.e2e.test.ts"],
  { cwd: desktop, stdio: "inherit", windowsHide: true, env: { ...process.env, VUA_MODULE_ISOLATION_TEST: "1", VUA_TEST_HOST_EXECUTABLE: host, VUA_TEST_AMF_EXECUTABLE: amf } });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Module isolation test failed (${result.status ?? result.signal})`);
