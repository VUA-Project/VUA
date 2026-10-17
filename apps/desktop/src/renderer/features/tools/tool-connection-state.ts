import type { ExternalToolSnapshot } from "@vua/contracts";
import type { EnvironmentAction } from "../home/EnvironmentCard.tsx";

/** Status keys into strings.toolConnection; the card formats them with the tool title. */
export type ToolConnectionStatusKey = "closeApp" | "openApp" | "running" | "install" | "prepareSteam" | "unknown" | "checking" | "waitInstall" | "waitOpen" | "waitClose";

/**
 * SteamToolCard 的 action/status 纯推导(VrcftCard 状态机去掉设备门):
 * 等待中(busy)优先于一切事实;无快照/取数失败只有重检;Steam 未就绪时
 * 唯一出路是准备 Steam;已安装可启动,本轮启动的实例才可关闭;读不出
 * 安装状态时既不假定已装也不假定未装。
 */
export function deriveToolCardState(live: { snapshot: ExternalToolSnapshot | null; pending: boolean; failed: boolean }): { action: EnvironmentAction; status: ToolConnectionStatusKey } {
  const s = live.snapshot;
  const waiting = !!s && s.activity !== "idle";
  if (live.pending || waiting) return { action: "busy", status: s?.activity === "install_requested" ? "waitInstall" : s?.activity === "stopping" ? "waitClose" : "waitOpen" };
  if (!s || live.failed) return { action: "unknown", status: live.failed ? "unknown" : "checking" };
  if (s.canStop) return { action: "stop", status: "closeApp" };
  if (!s.steamReady) return { action: "prepare", status: "prepareSteam" };
  if (s.presence === "installed") return { action: "start", status: s.running ? "running" : "openApp" };
  if (s.presence === "unknown") return { action: "unknown", status: "unknown" };
  return { action: "prepare", status: "install" };
}
