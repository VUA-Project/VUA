import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { isAmfProductionParams, isAmfAssemblySelection, readAmfProductionProgress, isAmfStep, isAmfUsualDurations, isAmfRunProgress, AMF_RUN_PHASES } from "./amf-production-v01.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isApplicationRequestV01 } from "./application-contract.js";

const selection = { avatarPrefab:"Assets/Avatar.prefab",outfits:[{sourceId:"outfit",prefabPath:"Assets/Outfit.prefab",mode:"merge_armature",bone:"",toggleName:"Coat",active:true}] };
describe("AMF material-first Candidate boundary", () => {
  it("consumes the shared positive and negative native request vectors", () => {
    const root = new URL("../../../schemas/amf-production-flow/v0.1/examples/", import.meta.url);
    for (const name of readdirSync(root)) {
      const value = JSON.parse(readFileSync(new URL(name,root),"utf8"));
      const envelope = {contractVersion:"0.1",requestId:"req-vector",correlationId:"corr-vector",...value,
        ...(value.kind === "command" ? {commandId:"cmd-vector"} : {})};
      expect(isApplicationRequestV01(envelope),name).toBe(name.includes(".valid."));
    }
  });
  it("registers the same closed face in both desktop and native requests", () => {
    const params = {schemaVersion:"0.1",runId:"n3-test",selection,planDigest:"a".repeat(64)};
    expect(isDesktopGatewayRequestV1({schemaVersion:1,requestId:"req",method:"amf.production.assemble",params})).toBe(true);
    expect(isApplicationRequestV01({contractVersion:"0.1",requestId:"req",correlationId:"corr",kind:"command",commandId:"cmd",method:"amf.production.assemble",params})).toBe(true);
  });
  it("admits automatic source selection without inventing file paths", () => {
    const params = {schemaVersion:"0.1",sources:[{sourceId:"copy-1",role:"auto"}],editorPath:"C:/Unity/Editor/Unity.exe"};
    expect(isAmfProductionParams("amf.production.prepare",params)).toBe(true);
    expect(isAmfProductionParams("amf.production.prepare",{...params,projectRoot:"C:/Player/Project"})).toBe(false);
    expect(isAmfProductionParams("amf.production.prepare",{...params,sources:[{sourceId:"copy-1",role:"auto",path:"C:/Private"}]})).toBe(false);
  });
  it("refuses duplicate source identities and unknown schema versions", () => {
    expect(isAmfProductionParams("amf.production.prepare",{schemaVersion:"0.1",sources:[{sourceId:"copy-1",role:"auto"},{sourceId:"copy-1",role:"outfit"}],editorPath:"Unity.exe"})).toBe(false);
    expect(isAmfProductionParams("amf.production.list",{schemaVersion:"0.2"})).toBe(false);
  });
  it("requires a digest on execution and disallows implicit deletion fields", () => {
    expect(isAmfProductionParams("amf.production.assemble",{schemaVersion:"0.1",runId:"n3-test",selection,planDigest:""})).toBe(false);
    expect(isAmfAssemblySelection({...selection,deleteUnmentioned:true})).toBe(false);
  });
  it("reads progress events and run status from the shared vectors without log text", () => {
    const folder = (name: string) => new URL(`../../../schemas/amf-production-flow/v0.1/${name}/`, import.meta.url);
    for (const name of readdirSync(folder("progress-examples"))) {
      const value: unknown = JSON.parse(readFileSync(new URL(name, folder("progress-examples")), "utf8"));
      expect(readAmfProductionProgress(value) !== null, name).toBe(name.includes(".valid."));
    }
    const status = (v: Record<string, unknown>) => (AMF_RUN_PHASES as readonly unknown[]).includes(v.phase)
      && Array.isArray(v.steps) && v.steps.every(isAmfStep) && isAmfUsualDurations(v.usualDurations) && (v.progress === null || isAmfRunProgress(v.progress));
    for (const name of readdirSync(folder("status-examples"))) {
      const value = JSON.parse(readFileSync(new URL(name, folder("status-examples")), "utf8")) as Record<string, unknown>;
      expect(status(value), name).toBe(name.includes(".valid."));
    }
    expect(readAmfProductionProgress({ completed: 1, messageKey: "tasks.download.transfer" })).toBeNull();
  });
  it("does not authorize mutating commands as queries or traversal identities", () => {
    expect(isApplicationRequestV01({contractVersion:"0.1",requestId:"req",correlationId:"corr",kind:"query",method:"amf.production.open",params:{schemaVersion:"0.1",runId:"n3-test"}})).toBe(false);
    expect(isAmfProductionParams("amf.production.get",{schemaVersion:"0.1",runId:"../other"})).toBe(false);
  });

  it("accepts every step the AMF engine records, including release steps", () => {
    for (const key of ["project", "materials", "inspect", "reinspect", "snapshot", "assembly", "protect_current", "restore", "turntable", "upload"])
      expect(isAmfStep({ key, name: key, state: "succeeded", detail: "", startedAt: "2026-10-17T15:00:00.000Z", endedAt: "2026-10-17T15:01:00.000Z" }), key).toBe(true);
  });
});
