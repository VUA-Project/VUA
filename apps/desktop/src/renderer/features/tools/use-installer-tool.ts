import { useCallback, useEffect, useRef, useState } from "react";
import {
  OFFICIAL_TOOL_URLS,
  isTerminalTaskStateV01,
  type DeploymentProgress,
  type InstallerToolAction,
  type InstallerToolId,
  type InstallerToolSnapshot,
  type TaskSnapshotV01,
} from "@vua/contracts";
import type { IconName } from "@vua/design-system";
import { openExternalUrl } from "../../app/open-external.ts";
import { useUnityMirrors } from "../../app/unity-download-preference.ts";
import { useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
import type { EnvironmentAction } from "../home/EnvironmentCard.tsx";

const DEFAULT_EDITOR_ROOT = "C:\\Program Files\\Unity\\Hub\\Editor";

type InstallerCopy = typeof strings.installerTool;
type ToolConnectionCopy = typeof strings.toolConnection;

export interface InstallerCardState {
  readonly action: EnvironmentAction;
  readonly status: string;
  readonly actionIcon?: IconName;
  readonly percent: number | null;
  readonly busy: boolean;
}

export function installerProgressPercent(step: DeploymentProgress | null): number | null {
  if (!step || step.phase !== "downloading") return null;
  if (typeof step.totalBytes !== "number" || step.totalBytes <= 0 || typeof step.completedBytes !== "number") return null;
  return Math.max(0, Math.min(100, Math.round((step.completedBytes / step.totalBytes) * 100)));
}

export function describeInstallerStage(step: DeploymentProgress | null, copy: InstallerCopy): string {
  switch (step?.phase) {
    case "started":
    case "resolving_source":
      return copy.stages.resolving;
    case "downloading":
      return copy.stages.downloading;
    case "verifying":
      return copy.stages.verifying;
    case "installing":
    case "registering":
      return copy.stages.installing;
    case "inspecting":
    case "verified":
      return copy.stages.checking;
    default:
      return copy.installing;
  }
}

export function describeInstallerError(code: string, copy: InstallerCopy): string {
  const normalized = code.toLowerCase();
  if (normalized.includes("cancel") || normalized.includes("uac") || normalized.includes("elevation") || normalized.includes("abort")) {
    return copy.errors.uacCancelled;
  }
  if (normalized.includes("invalid_location") || normalized.includes("reparse")) {
    return copy.errors.invalidLocation;
  }
  if (normalized.includes("download") || normalized.includes("source") || normalized.includes("network") || normalized.includes("hash") || normalized.includes("verify")) {
    return copy.errors.downloadFailed;
  }
  return format(copy.errors.generic, { code: code.replace(/^vua\.deployment\./, "") });
}

export function deriveInstallerCardState(
  input: {
    readonly snapshot: InstallerToolSnapshot | null;
    readonly pending: boolean;
    readonly failed: boolean;
    readonly available: boolean;
    readonly installing: boolean;
    readonly cancelling: boolean;
    readonly step: DeploymentProgress | null;
  },
  copy: InstallerCopy,
  tc: ToolConnectionCopy,
): InstallerCardState {
  if (input.installing) {
    const percent = installerProgressPercent(input.step);
    return {
      action: "busy",
      status: input.cancelling ? copy.cancelling : percent !== null ? `${copy.installing} ${percent}%` : copy.installing,
      percent,
      busy: true,
    };
  }
  const s = input.snapshot;
  const waiting = !!s && s.activity !== "idle";
  if (input.pending || waiting) {
    return {
      action: "busy",
      status: s?.activity === "stopping" ? tc.short.waitClose : tc.short.waitOpen,
      percent: null,
      busy: true,
    };
  }
  if (input.failed || !input.available) {
    return { action: "unknown", status: tc.short.unknown, percent: null, busy: false };
  }
  if (!s) {
    return { action: "busy", status: tc.short.checking, percent: null, busy: true };
  }
  if (s.canStop) {
    return { action: "stop", status: tc.short.closeApp, percent: null, busy: false };
  }
  if (s.presence === "installed") {
    return { action: "start", status: s.running ? tc.short.running : tc.short.openApp, percent: null, busy: false };
  }
  if (s.presence === "unknown") {
    return { action: "unknown", status: tc.short.unknown, percent: null, busy: false };
  }
  return { action: "prepare", status: tc.short.install, actionIcon: "download", percent: null, busy: false };
}

const activeToolTasks = new Map<InstallerToolId, string>();

export function useInstallerTool(toolId: InstallerToolId) {
  const gateway = useGateway();
  const port = gateway.environment.installerTools;
  const deployment = gateway.environment.deployment;
  const useMirrors = useUnityMirrors();
  const [snapshot, setSnapshot] = useState<InstallerToolSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [taskId, setTaskIdState] = useState<string | null>(() => activeToolTasks.get(toolId) ?? null);
  const setTaskId = useCallback((next: string | null) => {
    if (next === null) activeToolTasks.delete(toolId);
    else activeToolTasks.set(toolId, next);
    setTaskIdState(next);
  }, [toolId]);
  const [task, setTask] = useState<TaskSnapshotV01 | null>(null);
  const [step, setStep] = useState<DeploymentProgress | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const epoch = useRef(0);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    const version = ++epoch.current;
    try {
      if (!port) throw new Error("unavailable");
      const next = await port.observe(toolId);
      if (active.current && version === epoch.current) {
        setSnapshot(next);
        setFailed(false);
      }
    } catch {
      if (active.current && version === epoch.current) {
        setFailed(true);
        setSnapshot(null);
      }
    }
  }, [port, toolId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await refresh();
      if (!cancelled) timer = setTimeout(() => { void poll(); }, document.documentElement.dataset.effects === "off" ? 5000 : 2000);
    };
    void poll();
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      active.current = false;
      ++epoch.current;
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!deployment || taskId === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latestCause: string | undefined;
    const unsubscribe = deployment.subscribe(taskId, nextStep => {
      if (nextStep.component !== toolId) return;
      if (nextStep.cause) latestCause = nextStep.cause;
      if (alive) setStep(nextStep);
    });
    const pollTask = async () => {
      try {
        const current = await deployment.status(taskId);
        if (!alive) return;
        setTask(current);
        const terminal = isTerminalTaskStateV01(current.state) || current.recoveryDisposition === "inspect_required";
        if (!terminal) {
          timer = setTimeout(() => { void pollTask(); }, 1000);
          return;
        }
        setCancelPending(false);
        setTaskId(null);
        if (current.state === "cancelled") {
          setInstallError("user_cancelled");
        } else if (current.state === "failed" || current.recoveryDisposition === "inspect_required") {
          setInstallError(current.error?.code ?? latestCause ?? "installation_failed");
        } else {
          setInstallError(null);
        }
        await refresh();
      } catch {
        if (alive) timer = setTimeout(() => { void pollTask(); }, 2500);
      }
    };
    void pollTask();
    return () => {
      alive = false;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [deployment, taskId, toolId, refresh]);

  const act = async (action: InstallerToolAction) => {
    if (!port || busy.current) return;
    busy.current = true;
    ++epoch.current;
    setPending(true);
    try {
      const next = await port.act(toolId, action, crypto.randomUUID());
      if (active.current) {
        setSnapshot(next);
        setFailed(false);
      }
    } catch {
      if (active.current) {
        setFailed(true);
        setSnapshot(null);
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  };

  const install = async (reinstall = false) => {
    if (planning || taskId !== null) return;
    if (!deployment) {
      void openExternalUrl(OFFICIAL_TOOL_URLS[toolId]);
      return;
    }
    setPlanning(true);
    setInstallError(null);
    setStep(null);
    setTask(null);
    try {
      const plan = await deployment.plan({
        tools: [toolId],
        ...(reinstall ? { reinstallTools: [toolId] } : {}),
        editorRoot: DEFAULT_EDITOR_ROOT,
        useMirrors,
      });
      if (!reinstall && plan.prerequisitesReady) {
        await refresh();
        return;
      }
      const id = await deployment.execute(plan, crypto.randomUUID());
      if (active.current) setTaskId(id);
    } catch (err) {
      if (active.current) {
        const message = err instanceof Error && err.message ? err.message : "plan_failed";
        setInstallError(message);
      }
    } finally {
      if (active.current) setPlanning(false);
    }
  };

  const cancelInstall = async () => {
    if (!deployment || taskId === null || task === null || isTerminalTaskStateV01(task.state) || task.cancellationRequested) return;
    setCancelPending(true);
    try {
      await deployment.cancel(task.taskId, task.revision);
    } catch {
      if (active.current) setCancelPending(false);
    }
  };

  const taskActive = taskId !== null && (task === null || (!isTerminalTaskStateV01(task.state) && task.recoveryDisposition !== "inspect_required"));
  const installing = planning || taskActive;
  const cancelling = cancelPending || !!task?.cancellationRequested;
  const canCancelInstall = taskActive && task !== null && !task.cancellationRequested && !!deployment;

  return {
    snapshot,
    pending,
    failed,
    available: !!port,
    canDeploy: !!deployment,
    installing,
    cancelling,
    cancelPending,
    canCancelInstall,
    step,
    installError,
    refresh,
    act,
    install,
    cancelInstall,
  };
}
