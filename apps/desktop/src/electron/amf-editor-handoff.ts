import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APPLICATION_CONTRACT_VERSION } from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";

/** Mechanism only: AMF admits the Editor/run before issuing the task. The
 * GUI is launched outside the strict AMF worker job and survives its shutdown. */
export async function launchAmfEditor(provider: OrchestratorProviderV01, runId: string, localTestTaskId?: string): Promise<void> {
  const requestId = crypto.randomUUID();
  const response = await provider.invoke({contractVersion:APPLICATION_CONTRACT_VERSION,requestId,correlationId:requestId,
    kind:"query",method:"amf.production.get",params:{schemaVersion:"0.1",runId}});
  if (!response.ok) return;
  const run = response.value as unknown as Record<string,unknown>;
  if (run.runId !== runId || (localTestTaskId === undefined && run.phase !== "succeeded") || typeof run.projectRoot !== "string" || !path.isAbsolute(run.projectRoot)
    || !run.editor || typeof run.editor !== "object") return;
  const editor = run.editor as Record<string,unknown>;
  if (typeof editor.path !== "string" || !path.isAbsolute(editor.path) || (editor.version !== "2022.3.22f1" && editor.version !== "2022.3.22f1c1")) return;
  if (localTestTaskId !== undefined) {
    // A queued task has not refreshed the Bridge or written its request yet. Return the accepted
    // command promptly and launch only when this task's own request is ready.
    const readState = async () => {
      const id = crypto.randomUUID();
      const state = await provider.invoke({ contractVersion: APPLICATION_CONTRACT_VERSION, requestId: id, correlationId: id,
        kind: "query", method: "task.get", params: { taskId: localTestTaskId } });
      return state.ok ? state.value : null;
    };
    void waitForLocalTestRequest(run.projectRoot, runId, localTestTaskId, readState)
      .then(ready => ready ? launchAmfEditor(provider, runId) : undefined).catch(() => {});
    return;
  }
  // Already-open projects consume the new request through the Bridge observer.
  if (fs.existsSync(path.join(run.projectRoot,"Temp","UnityLockfile"))) return;
  const success = await new Promise<boolean>(resolve => {
    const child = spawn(editor.path as string,["-projectPath",run.projectRoot as string],{
      detached:true,windowsHide:true,stdio:"ignore",env:editorEnvironment(process.env),
    });
    child.once("error",()=>resolve(false)); child.once("spawn",()=>{child.unref();resolve(true);});
  });
  if (!success) {
    try {
      const bridgeDir = path.join(run.projectRoot, ".vua", "bridge");
      fs.mkdirSync(bridgeDir, { recursive: true });
      const pending = path.join(bridgeDir, "amf-open.result.pending");
      fs.writeFileSync(pending, JSON.stringify({ schemaVersion: "0.1", runId, avatarSelected: false, sdkPanelRequested: false, reason: "editor_unavailable" }));
      fs.renameSync(pending, path.join(bridgeDir, "amf-open.result.json"));
    } catch { /* Recording open-handoff failure must never prevent failing pending SDK tasks. */ }
    failSdkTasks(run.projectRoot, runId);
  }
}

export async function waitForLocalTestRequest(projectRoot: string, runId: string, taskId: string,
  readState: () => Promise<unknown>, pause: () => Promise<void> = () => new Promise(resolve => { setTimeout(resolve, 250).unref(); }),
): Promise<boolean> {
  const expected = `test-${taskId.replace(/[^A-Za-z0-9-]/gu, "").slice(0, 80)}`;
  for (;;) {
    const value = await readState();
    if (!value || typeof value !== "object") return false;
    const task = value as Record<string, unknown>;
    if (task.taskId !== taskId || task.cancellationRequested === true || task.recoveryDisposition !== "none"
      || !["queued", "preparing", "running", "waiting_for_input", "paused"].includes(String(task.state))) return false;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(projectRoot, ".vua", "bridge", "amf-test.json"), "utf8")) as Record<string, unknown>;
      if (task.state !== "paused" && value.schemaVersion === "0.1" && value.runId === runId && value.testId === expected) return true;
    } catch { /* The admitted worker writes the request after refreshing the Bridge. */ }
    await pause();
  }
}

/** A pending SDK task ends at once when Unity cannot start. */
export function failSdkTasks(projectRoot: string, runId: string): void {
  const bridge = path.join(projectRoot,".vua","bridge");
  for (const [name, key] of [["amf-upload", "uploadId"], ["amf-test", "testId"]] as const) {
  let request: unknown;
  try { request = JSON.parse(fs.readFileSync(path.join(bridge,`${name}.json`),"utf8")); } catch { continue; }
  if (!request || typeof request !== "object" || (request as Record<string,unknown>).runId !== runId
    || (request as Record<string,unknown>).schemaVersion !== "0.1") continue;
  const identity = (request as Record<string,unknown>)[key];
  if (typeof identity !== "string" || !/^[A-Za-z0-9-]{1,100}$/u.test(identity)) continue;
  const pending = path.join(bridge,`${name}.result.pending`);
  fs.writeFileSync(pending,JSON.stringify({schemaVersion:"0.1",runId,[key]:identity,outcome:"failed",reason:"editor_unavailable",detail:"Unity could not start.",errors:[]}));
  fs.renameSync(pending, path.join(bridge,`${name}.result.json`));
  }
}

export function editorEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Upstream owns the user's Unity session; inherited application credentials are omitted.
  return Object.fromEntries(Object.entries(source).filter(([name])=>!/(?:TOKEN|SECRET|PASSWORD|API_KEY|BOOTH|GITHUB|^GH_|COOKIE)/iu.test(name)));
}
