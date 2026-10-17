import { describe, expect, it } from "vitest";
import { isAmfProductionRun, createAmfProductionPort } from "./amf-production-port.ts";
import type { GatewayClient } from "./gateway-client.ts";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";

const selection = {avatarPrefab:"Assets/Avatar.prefab",outfits:[{sourceId:"coat",prefabPath:"Assets/Coat.prefab",mode:"merge_armature" as const,bone:"",toggleName:"Coat",active:true}]};
const run = {schemaVersion:"0.1",runId:"n3-test",phase:"succeeded",taskId:"task-test",editor:{path:"C:/Unity/Editor/Unity.exe",version:"2022.3.22f1c1"},projectRoot:"C:/Managed/test",
  choices:[{sourceId:"coat",role:"auto"}],sources:[],prefabs:[],steps:[],selection,error:null,recovery:null,snapshotId:"n3-snapshot",
  result:{facts:{sdkDescriptorRecognized:true,missingReferences:0,avatarName:"Avatar",instances:[{sourceId:"coat",bindingVerified:true,menuVerified:true,menuModified:true}]}}};

describe("AMF production response boundary", () => {
  it("refuses malformed results and preserves full Editor identity", () => {
    expect(isAmfProductionRun(run)).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,instances:"passed"}}})).toBe(false);
    expect(isAmfProductionRun({...run,editor:{...run.editor,version:"2022.3.22"}})).toBe(false);
    expect(isAmfProductionRun({...run,choices:[{sourceId:"coat",role:"any-role"}]})).toBe(false);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,observedSelection:selection}}})).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,observedSelection:{...selection,outfits:[{...selection.outfits[0],active:"false"}]}}}})).toBe(false);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,hasMissingScripts:"none"}}})).toBe(false);
  });
  it("accepts the SDK's own checks only in their published shape", () => {
    const sdkReview = { state: "checked", platform: "pc", overall: "Poor", detail: "",
      issues: [{ level: "error", text: "This avatar has no pipeline manager component.", canFix: true }],
      stats: [{ category: "BoneCount", rating: "Poor", text: "Bones: 300" }] };
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,sdkReview}}})).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,sdkReview:{...sdkReview,overall:"None",state:"unavailable"}}}})).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,sdkReview:{...sdkReview,state:"done"}}}})).toBe(false);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,sdkReview:{...sdkReview,stats:[{category:"BoneCount",rating:"Bad",text:""}]}}}})).toBe(false);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,sdkReview:{...sdkReview,issues:[{level:"error",text:"x",canFix:"yes"}]}}}})).toBe(false);
  });
  it("accepts previews only inside the work project's preview folder", () => {
    const previews = [{view:"front",path:".vua/previews/n3-test-1/front.png"},{view:"side",path:".vua/previews/n3-test-1/side.png"}];
    const prefab = {sourceId:"coat",path:"Assets/Coat.prefab",name:"Coat",isAvatar:false,hasSkinnedMesh:true,hasMergeArmature:true,hasMissingScripts:false,humanoidBones:[]};
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,preview:".vua/previews/n3-test-0/candidate-000.png"}],result:{facts:{...run.result.facts,previews}}})).toBe(true);
    expect(isAmfProductionRun({...run,prefabs:[prefab]})).toBe(true);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,preview:"C:/Users/me/secret.png"}]})).toBe(false);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,preview:".vua/previews/../../Assets/x.png"}]})).toBe(false);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,previews:[{view:"top",path:previews[0]?.path}]}}})).toBe(false);
  });
  it("accepts a stopped run with step times, usual durations and live progress", () => {
    const steps = [{key:"inspect",name:"Identify actual Avatar and outfit prefabs",state:"stopped",detail:"",startedAt:"2026-10-17T08:00:00.000Z",endedAt:"2026-10-17T08:04:10.000Z"}];
    const stopped = {...run,phase:"stopped",steps,usualDurations:{inspect:412},progress:null};
    expect(isAmfProductionRun(stopped)).toBe(true);
    const progress = {step:"reinspect",name:"Reinspect the retained work project",startedAt:"2026-10-17T08:10:00.000Z",elapsedSeconds:95,usualSeconds:null,
      unity:{stage:"importing",current:240,total:379,lastActivityAt:"2026-10-17T08:11:33.000Z"}};
    expect(isAmfProductionRun({...stopped,phase:"inspecting",progress})).toBe(true);
    expect(isAmfProductionRun({...stopped,phase:"paused"})).toBe(false);
    expect(isAmfProductionRun({...stopped,steps:[{...steps[0],startedAt:undefined}]})).toBe(false);
    expect(isAmfProductionRun({...stopped,steps:[{...steps[0],state:"waiting"}]})).toBe(false);
    expect(isAmfProductionRun({...stopped,usualDurations:{inspect:-1}})).toBe(false);
    expect(isAmfProductionRun({...stopped,progress:{...progress,unity:{...progress.unity,line:"Start importing Assets/Coat.prefab"}}})).toBe(false);
    expect(isAmfProductionRun({...stopped,progress:{...progress,unity:{...progress.unity,stage:"downloading"}}})).toBe(false);
  });
  it("stops through task cancellation and reads only AMF progress events", async () => {
    const requests: unknown[] = [];
    let emit: (event: unknown) => void = () => {};
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:{} as DesktopGatewaySuccessValueV1};},
      subscribe(listener){emit = event => listener(event as Parameters<typeof listener>[0]);return()=>{};}};
    const port = createAmfProductionPort(client);
    await port.stop({taskId:"task-amf"});
    expect(requests[0]).toMatchObject({method:"task.requestCancellation",params:{taskId:"task-amf"}});
    await expect(port.stop({taskId:""})).rejects.toThrow("not_running");
    const seen: unknown[] = [];
    port.onProgress(progress => seen.push(progress));
    const payload = {operation:"amf.production",runId:"n3-test",step:"inspect",name:"Identify actual Avatar and outfit prefabs",startedAt:"2026-10-17T08:00:00.000Z",
      unity:{stage:"importing",current:12,total:379,lastActivityAt:"2026-10-17T08:01:00.000Z"}};
    emit({kind:"task.progressed",taskId:"task-amf",payload});
    emit({kind:"task.progressed",taskId:"task-download",payload:{completed:1,messageKey:"tasks.download.transfer"}});
    emit({kind:"task.progressed",taskId:"task-amf",payload:{...payload,unity:{...payload.unity,log:"[Licensing::Client] ..."}}});
    emit({kind:"task.stateChanged",taskId:"task-amf",payload:{}});
    expect(seen).toEqual([payload]);
  });
  it("turns a reported preview into a PNG data URL", async () => {
    const path = ".vua/previews/n3-test-1/front.png";
    let response: unknown = {schemaVersion:"0.1",runId:"n3-test",path,mediaType:"image/png",data:"iVBORw0KGgoAAAANSUhEUg=="};
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect(await port.previewImage("n3-test",path)).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    expect(requests[0]).toMatchObject({method:"amf.production.previewImage",params:{schemaVersion:"0.1",runId:"n3-test",path}});
    response = {schemaVersion:"0.1",runId:"n3-test",path,mediaType:"image/png",data:"PHN2Zz48L3N2Zz4="};
    await expect(port.previewImage("n3-test",path)).rejects.toThrow("preview_invalid");
    response = {schemaVersion:"0.1",runId:"n3-test",path:".vua/previews/n3-test-1/back.png",mediaType:"image/png",data:"iVBORw0KGgo="};
    await expect(port.previewImage("n3-test",path)).rejects.toThrow("preview_invalid");
  });
  it("does not accept a plan that omits preservation or fabricates SDK completion", async () => {
    const plan = {schemaVersion:"0.1",runId:"n3-test",planDigest:"a".repeat(64),selection,inputs:[],editor:run.editor,projectRoot:run.projectRoot,preserveOriginals:true,officialSdkChecks:"not_run"};
    let response: unknown = plan;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.plan("n3-test",selection)).selection).toEqual(selection);
    response = {...plan,officialSdkChecks:"passed"}; await expect(port.plan("n3-test",selection)).rejects.toThrow("plan_invalid");
    response = {...plan,preserveOriginals:false}; await expect(port.plan("n3-test",selection)).rejects.toThrow("plan_invalid");
  });
  it("requires a restore plan to preserve current work and belong to this run", async () => {
    const plan = {schemaVersion:"0.1",runId:"n3-test",planDigest:"a".repeat(64),snapshotId:"n3-snapshot",projectRoot:run.projectRoot,currentChanged:true,preserveCurrent:true};
    let response: unknown = plan;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.rollbackPlan("n3-test")).currentChanged).toBe(true);
    response = {...plan,preserveCurrent:false}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    response = {...plan,runId:"n3-other"}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    response = {...plan,snapshotId:""}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    await expect(port.rollback("n3-other",{...plan,preserveCurrent:true})).rejects.toThrow("restore_plan_invalid");
  });
  it("binds comparison and execution to the chosen observed Avatar", async () => {
    const plan = {runId:"n3-test",recipeId:"recipe-test",title:"Recipe",avatarName:"Same name",avatarGlobalObjectId:"other-avatar",planDigest:"d".repeat(64),retainedOutfits:0,overlayBlocker:null,
      conflicts:[],recipeSelection:selection,currentSelection:selection,targets:[{globalObjectId:"active-avatar",name:"Same name",verified:true},{globalObjectId:"other-avatar",name:"Same name",verified:true}]};
    let response: unknown = {schemaVersion:"0.1",plan};
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    const reviewed = await port.recipeApplyPlan("n3-test","recipe-test","other-avatar");
    expect(requests[0]).toMatchObject({params:{avatarGlobalObjectId:"other-avatar"}});
    response = {schemaVersion:"0.1",runId:"n3-test",taskId:"task-apply"};
    await port.applyRecipe(reviewed,"avatar_wins");
    expect(requests[1]).toMatchObject({params:{avatarGlobalObjectId:"other-avatar",choice:"avatar_wins",planDigest:plan.planDigest}});
    for (const changed of [{...plan,avatarGlobalObjectId:"active-avatar"},{...plan,targets:[plan.targets[1],plan.targets[1]]},{...plan,targets:plan.targets.map(t=>({...t,verified:false}))}]) {
      response = {schemaVersion:"0.1",plan:changed};
      await expect(port.recipeApplyPlan("n3-test","recipe-test","other-avatar")).rejects.toThrow("apply_plan_invalid");
    }
  });
});
