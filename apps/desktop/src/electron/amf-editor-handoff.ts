import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { APPLICATION_CONTRACT_VERSION } from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";

/** Mechanism only: AMF admits the Editor/run before issuing the task. The
 * GUI is launched outside the strict AMF worker job and survives its shutdown. */
export async function launchAmfEditor(provider: OrchestratorProviderV01, runId: string): Promise<void> {
  const requestId = crypto.randomUUID();
  const response = await provider.invoke({contractVersion:APPLICATION_CONTRACT_VERSION,requestId,correlationId:requestId,
    kind:"query",method:"amf.production.get",params:{schemaVersion:"0.1",runId}});
  if (!response.ok) return;
  const run = response.value as unknown as Record<string,unknown>;
  if (run.runId !== runId || run.phase !== "succeeded" || typeof run.projectRoot !== "string" || !path.isAbsolute(run.projectRoot)
    || !run.editor || typeof run.editor !== "object") return;
  const editor = run.editor as Record<string,unknown>;
  if (typeof editor.path !== "string" || !path.isAbsolute(editor.path) || (editor.version !== "2022.3.22f1" && editor.version !== "2022.3.22f1c1")) return;
  // Already-open projects consume the new request through the Bridge observer.
  if (fs.existsSync(path.join(run.projectRoot,"Temp","UnityLockfile"))) return;
  const success = await new Promise<boolean>(resolve => {
    const child = spawn(editor.path as string,["-projectPath",run.projectRoot as string],{
      detached:true,windowsHide:true,stdio:"ignore",env:editorEnvironment(process.env),
    });
    child.once("error",()=>resolve(false)); child.once("spawn",()=>{child.unref();resolve(true);});
  });
  if (!success) {
    fs.writeFileSync(path.join(run.projectRoot,".vua","bridge","amf-open.result.json"),JSON.stringify({schemaVersion:"0.1",runId,avatarSelected:false,sdkPanelRequested:false}));
    failUpload(run.projectRoot, runId);
  }
}

/** A pending managed upload ends at once when Unity cannot start, so the release room shows why. */
function failUpload(projectRoot: string, runId: string): void {
  const bridge = path.join(projectRoot,".vua","bridge");
  let request: unknown;
  try { request = JSON.parse(fs.readFileSync(path.join(bridge,"amf-upload.json"),"utf8")); } catch { return; }
  if (!request || typeof request !== "object" || (request as Record<string,unknown>).runId !== runId) return;
  const uploadId = (request as Record<string,unknown>).uploadId;
  if (typeof uploadId !== "string" || !/^[A-Za-z0-9-]{1,100}$/u.test(uploadId)) return;
  fs.writeFileSync(path.join(bridge,"amf-upload.result.json"),JSON.stringify({schemaVersion:"0.1",runId,uploadId,outcome:"failed",reason:"editor_unavailable",detail:"Unity could not start.",errors:[]}));
}

export function editorEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Upstream owns the user's Unity session; inherited application credentials are omitted.
  return Object.fromEntries(Object.entries(source).filter(([name])=>!/(?:TOKEN|SECRET|PASSWORD|API_KEY|BOOTH|GITHUB|^GH_|COOKIE)/iu.test(name)));
}
