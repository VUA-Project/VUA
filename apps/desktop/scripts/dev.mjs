import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const useShell = process.platform === "win32";
const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
// Distinct worktrees may run concurrently with separate renderer ports.
const VITE_PORT = Number(process.env.VUA_DEV_PORT ?? "5173");
if (!Number.isInteger(VITE_PORT) || VITE_PORT < 1 || VITE_PORT > 65535) {
  throw new Error("VUA_DEV_PORT must be an integer from 1 to 65535");
}

// #29 裁决(集成 2026-09-15 深夜,缺陷成立=dev 工具链护栏缺口):Windows 下
// spawn(pnpm, {shell:true}) 的实际进程树是 cmd.exe → pnpm → vite/electron,
// 子进程对象只指向 cmd/pnpm 包装层,kill() 杀掉包装层后孙进程(vite/electron)
// 孤儿化——残留 vite 持 5173 即此机制产物(2026-09-13 19:00 起残留两日的实例)。
// 退出路径改用 taskkill /T /F 树杀:整树(含孙进程)一并终止,非常规退出
// (终端直闭/进程强杀跳过 finally 的情况除外)不再产生孤儿。已退出或从未
// 拉起的进程直接跳过;taskkill 自身是独立进程,本脚本退出不影响其执行。
function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (useShell) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill();
  }
}

/* 启动前自愈(preflight):5173 被本仓残留 vite 占用时先树杀再启动。
 * 必要性:vite strictPort 下旧实例占口会让新 vite 直接起不来,而 electron
 * 照 URL 加载到旧实例服务的前代渲染层——"打开的不是最新 main"的机制根因。
 * 安全边界:只杀命令行同时含 "vite" 与本仓根路径(带尾分隔符,防 VUA-2 等
 * 兄弟 worktree 前缀误伤)的进程;占口进程不符合即如实报错退出,绝不碰外部进程。
 * VUA_DEV_PREFLIGHT_DRYRUN=1 时只报告不杀,供排查。 */
function listenerPids(port) {
  if (!useShell) return [];
  let out;
  try {
    out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match && Number(match[1]) === port) pids.add(Number(match[2]));
  }
  return [...pids];
}

function commandLineOf(pid) {
  try {
    return execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function isOwnVite(commandLine) {
  const lower = commandLine.toLowerCase();
  return lower.includes("vite") && lower.includes(`${REPO_ROOT.toLowerCase()}\\`);
}

async function waitPortFree(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (listenerPids(port).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.error(`[dev] port ${port} still held after clearing stale listener; aborting.`);
  process.exit(1);
}

function preflightPort(port) {
  const pids = listenerPids(port);
  const dryRun = Boolean(process.env.VUA_DEV_PREFLIGHT_DRYRUN);
  for (const pid of pids) {
    const commandLine = commandLineOf(pid);
    if (!isOwnVite(commandLine)) {
      console.error(
        `[dev] port ${port} is held by pid ${pid}, which is not this repo's vite; free it and retry.`,
      );
      process.exit(1);
    }
    if (dryRun) {
      console.log(`[dev] dry-run: would clear stale vite on :${port} (pid ${pid})`);
      continue;
    }
    console.log(`[dev] clearing stale vite on :${port} (pid ${pid})`);
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
  if (dryRun) {
    console.log("[dev] dry-run: preflight done, exiting before launch");
    process.exit(0);
  }
  return pids.length > 0;
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${VITE_PORT}`);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("renderer dev server did not start");
}

const killedStale = preflightPort(VITE_PORT);
if (killedStale) await waitPortFree(VITE_PORT);

// Refresh linked CJS packages before Vite prebundles or Electron imports them.
// TypeScript sees source types even when their runtime dist is still outdated.
const dependencies = spawn("pnpm", ["--filter", "@vua/orchestrator-provider", "build"], {
  stdio: "inherit", shell: useShell,
});
const dependencyCode = await new Promise((resolve) => dependencies.once("exit", resolve));
if (dependencyCode !== 0) throw new Error("Desktop runtime dependencies failed to build");

const vite = spawn("pnpm", ["exec", "vite", "--port", String(VITE_PORT)], { stdio: "inherit", shell: useShell });

// Electron 额外参数透传(W25 走查取证护栏,2026-09-23):VUA_ELECTRON_ARGS
// 以空格分词追加到 electron 命令(如 --remote-debugging-port=51993,供
// 挂死时 CDP Debugger.pause 抓主线程栈)。仅透传,不默认开启——取证面
// 只在显式要求时在场。
const extraArgs = (process.env.VUA_ELECTRON_ARGS ?? "").split(" ").filter(Boolean);

let electron;
try {
  const compile = spawn("pnpm", ["exec", "tsc", "-p", "tsconfig.electron.json"], {
    stdio: "inherit",
    shell: useShell,
  });
  const code = await new Promise((resolve) => compile.once("exit", resolve));
  if (code !== 0) throw new Error("Electron TypeScript compilation failed");
  await waitForRenderer();
  electron = spawn("pnpm", ["exec", "electron", ".", ...extraArgs], {
    stdio: "inherit",
    shell: useShell,
    env: { ...process.env, VUA_RENDERER_URL: `http://127.0.0.1:${VITE_PORT}` },
  });
  await new Promise((resolve) => electron.once("exit", resolve));
} finally {
  killTree(electron);
  killTree(vite);
}
