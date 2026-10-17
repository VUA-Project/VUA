import { build } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { assertBundledRuntime } from "./bundled-runtime.mjs";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(desktop, "../..");

// Bundle only reachable production code. Copying workspace node_modules also
// ships source tests and the unused Mock Provider. Separate builds keep the
// sandboxed preload self-contained (it may require Electron, not shared chunks).
for (const entry of ["main", "preload"]) {
  await build({
    configFile: false,
    publicDir: false,
    root: desktop,
    resolve: { conditions: ["node"], alias: {
      // Some Node adapters use bare builtins. Normalize these before Vite's
      // browser resolution so the desktop bundle keeps real Node capabilities.
      ...Object.fromEntries(builtinModules.filter(name => !name.startsWith("node:")).map(name => [name, `node:${name}`])),
      "@vua/contracts": path.join(workspace, "packages/contracts/src/index.ts"),
      "@vua/orchestrator-provider": path.join(workspace, "packages/orchestrator-provider/src/index.ts"),
    } },
    build: {
      outDir: path.join(desktop, "dist/packaged-electron"),
      emptyOutDir: entry === "main",
      target: "node24",
      minify: false,
      sourcemap: false,
      lib: { entry: path.join(desktop, `src/electron/${entry}.ts`), formats: ["cjs"], fileName: () => `${entry}.js` },
      rolldownOptions: { platform: "node", external: ["electron", /^node:/] },
    },
  });
  const source = readFileSync(path.join(desktop, `dist/packaged-electron/${entry}.js`), "utf8");
  if (source.includes("MockOrchestratorProviderV01")) throw new Error("Unused Mock Provider leaked into the package");
  // Inspect executable calls rather than matching text inside strings. AJV
  // carries standalone-code-generation templates containing require(...),
  // even though its actual validation runtime is already bundled.
  assertBundledRuntime(source, entry);
}
