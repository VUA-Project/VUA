import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { amfRunProblem, isAmfProductionRun, isAmfPlanPrediction, createAmfProductionPort } from "./amf-production-port.ts";
import type { GatewayClient } from "./gateway-client.ts";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";

const selection = {avatarPrefab:"Assets/Avatar.prefab",outfits:[{sourceId:"coat",prefabPath:"Assets/Coat.prefab",mode:"merge_armature" as const,bone:"",toggleName:"Coat",active:true}]};
const run = {schemaVersion:"0.1",runId:"n3-test",phase:"succeeded",taskId:"task-test",editor:{path:"C:/Unity/Editor/Unity.exe",version:"2022.3.22f1c1"},projectRoot:"C:/Managed/test",
  choices:[{sourceId:"coat",role:"auto"}],sources:[],prefabs:[],steps:[],selection,error:null,recovery:null,snapshotId:"n3-snapshot",
  result:{facts:{sdkDescriptorRecognized:true,missingReferences:0,avatarName:"Avatar",instances:[{sourceId:"coat",bindingVerified:true,menuVerified:true,menuModified:true}]}}};

describe("AMF production response boundary", () => {
  it("reads complete Recipe material plans and carries explicit package choices", async () => {
    const row={materialId:"material-2",packageName:"Coat.unitypackage",boothProductId:"1001",status:"material_not_downloaded",resolved:null,candidates:[],downloadNames:["Coat.zip"]};
    let response: unknown={schemaVersion:"0.1",plan:{recipeId:"recipe-test",materials:[row],materialChoices:{},ready:false,planDigest:"a".repeat(64)}};
    const requests: unknown[]=[];
    const client={invoke:async(request:unknown)=>{requests.push(request);return {ok:true,value:response};},subscribe:()=>()=>{}} as unknown as GatewayClient;
    const port=createAmfProductionPort(client);
    await expect(port.recipeMaterialPlan("recipe-test")).resolves.toMatchObject({ready:false,materials:[row]});
    response={schemaVersion:"0.1",plan:{recipeId:"recipe-test",materials:[{...row,boothProductId:"bad"}],materialChoices:{},ready:false,planDigest:"a".repeat(64)}};
    await expect(port.recipeMaterialPlan("recipe-test")).rejects.toThrow("material_plan_invalid");
    response={schemaVersion:"0.1",runId:"n3-test",taskId:"task-recipe"};
    await port.prepareRecipe("recipe-test","C:/Unity/Editor/Unity.exe",{"material-2":"source-2"});
    expect(requests.at(-1)).toMatchObject({method:"amf.production.prepareRecipe",params:{materialChoices:{"material-2":"source-2"}}});
  });
  it("validates optional Recipe differences and prefab evidence while retaining old reads", async () => {
    const recipeDifferences=[{kind:"prefab_mapped",materialId:"material-2",before:"Assets/Old.prefab",after:"Assets/Moved.prefab",rule:"guid",paths:[],count:1}];
    expect(isAmfProductionRun({...run,recipeDifferences})).toBe(true);
    expect(isAmfProductionRun({...run,recipeDifferences:[{...recipeDifferences[0],rule:"fuzzy"}]})).toBe(false);
    const prefab={sourceId:"coat",path:"Assets/Coat.prefab",name:"Coat",isAvatar:false,hasSkinnedMesh:true,hasMergeArmature:true,hasMissingScripts:false,humanoidBones:[],prefabGuid:"a".repeat(32),objectPaths:["","Clip"]};
    expect(isAmfProductionRun({...run,prefabs:[prefab]})).toBe(true);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,prefabGuid:"broken"}]})).toBe(false);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,objectPaths:["same","same"]}]})).toBe(false);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,hasVrcFury:true}]})).toBe(true);
    expect(isAmfProductionRun({...run,prefabs:[{...prefab,hasVrcFury:"yes"}]})).toBe(false);
    const plan={schemaVersion:"0.1",runId:"n3-test",planDigest:"b".repeat(64),selection,inputs:[],preserveOriginals:true,officialSdkChecks:"not_run",editor:run.editor,projectRoot:run.projectRoot,recipeDifferences};
    let response:unknown=plan;const requests:unknown[]=[];
    const client={invoke:async(request:unknown)=>{requests.push(request);return {ok:true,value:response};},subscribe:()=>()=>{}} as unknown as GatewayClient;
    const port=createAmfProductionPort(client);const reviewed=await port.plan("n3-test",selection);
    response={schemaVersion:"0.1",runId:"n3-test",taskId:"task-review"};
    await port.assemble("n3-test",reviewed,true);
    expect(requests.at(-1)).toMatchObject({method:"amf.production.assemble",params:{recipeDifferencesConfirmed:true,planDigest:plan.planDigest}});
  });
  it("validates the plan's pre-assembly prediction and keeps plans without it readable", async () => {
    const row={sourceId:"avatar",name:"Avatar",role:"avatar",triangles:10,materialSlots:1,textureBytes:20,physBones:0,parameterBits:8,uncompressedBytes:40,complete:true};
    const prediction={schemaVersion:"0.1",evidence:"unity_source_estimate",platform:"pc",available:true,
      tolerance:{counts:"exact",textureBytes:"decoded_estimate",uncompressedBytes:"within_25_percent"},
      rows:[row],total:{triangles:10,materialSlots:1,textureBytes:20,physBones:0,parameterBits:8,uncompressedBytes:40,complete:true}};
    expect(isAmfPlanPrediction(prediction)).toBe(true);
    const performanceRanks={pc:{rank:"good",limitingMetrics:[]},android:{rank:"very_poor",limitingMetrics:["triangles","skinnedMeshes","basicMeshes","materialSlots","textureBytes","physBones"]}};
    expect(isAmfPlanPrediction({...prediction,total:{...prediction.total,performanceRanks}})).toBe(true);
    expect(isAmfPlanPrediction({...prediction,total:{...prediction.total,performanceRanks:{...performanceRanks,pc:{rank:"Ultra",limitingMetrics:[]}}}})).toBe(false);
    expect(isAmfPlanPrediction({...prediction,total:{...prediction.total,performanceRanks:{...performanceRanks,android:{rank:"poor",limitingMetrics:["triangles","triangles"]}}}})).toBe(false);
    expect(isAmfPlanPrediction({...prediction,total:{...prediction.total,performanceRanks:{...performanceRanks,android:{rank:"poor",limitingMetrics:["boneCount"]}}}})).toBe(false);
    // An undecided parameter count stays null; a wrong tolerance or a missing total is refused.
    expect(isAmfPlanPrediction({...prediction,rows:[{...row,parameterBits:null,complete:false}]})).toBe(true);
    expect(isAmfPlanPrediction({...prediction,tolerance:{...prediction.tolerance,uncompressedBytes:"exact"}})).toBe(false);
    expect(isAmfPlanPrediction({...prediction,total:undefined})).toBe(false);
    expect(isAmfPlanPrediction({...prediction,available:false})).toBe(false);
    expect(isAmfPlanPrediction({...prediction,available:false,rows:[],total:undefined})).toBe(true);
    expect(isAmfPlanPrediction({...prediction,rows:[{...row,role:"import_only"}]})).toBe(false);
    const plan={schemaVersion:"0.1",runId:"n3-test",planDigest:"b".repeat(64),selection,inputs:[],
      preserveOriginals:true,officialSdkChecks:"not_run",editor:run.editor,projectRoot:run.projectRoot,prediction};
    const client={invoke:async()=>({ok:true,value:plan}),subscribe:()=>()=>{}} as unknown as GatewayClient;
    const port=createAmfProductionPort(client);
    expect((await port.plan("n3-test",selection)).prediction?.rows[0]?.parameterBits).toBe(8);
    const broken={invoke:async()=>({ok:true,value:{...plan,prediction:{...prediction,rows:[{...row,triangles:-1}]}}}),subscribe:()=>()=>{}} as unknown as GatewayClient;
    await expect(createAmfProductionPort(broken).plan("n3-test",selection)).rejects.toThrow("amf_production_plan_invalid");
    // A plan from an engine that predates the observation carries no prediction at all.
    const old={invoke:async()=>({ok:true,value:{...plan,prediction:undefined}}),subscribe:()=>()=>{}} as unknown as GatewayClient;
    expect((await createAmfProductionPort(old).plan("n3-test",selection)).prediction).toBeUndefined();
  });
  it("validates optional close facts while keeping old runs readable", () => {
    const editorClose = {schemaVersion:"0.1",runId:"n3-test",closeId:"close-1",outcome:"saved",
      scenesSaved:true,assetsSaved:true,editorClosed:true,reason:"",detail:""};
    expect(isAmfProductionRun(run)).toBe(true);
    expect(isAmfProductionRun({...run,editorClose})).toBe(true);
    for (const invalid of [null, {}, {...editorClose,runId:"n3-other"}, {...editorClose,assetsSaved:"yes"},
      {...editorClose,scenesSaved:false}, {...editorClose,outcome:"closed"}, {...editorClose,detail:"x".repeat(1001)}]) {
      expect(isAmfProductionRun({...run,editorClose:invalid})).toBe(false);
    }
  });
  it("preserves the optional project-open action and validates it", async () => {
    let params: Record<string, unknown> = {detail:"Save and close Unity first.",suggestedAction:"amf.production.closeEditor"};
    const client = {invoke:async()=>({ok:false,error:{kind:"application",error:{code:"vua.amf_production.project_open",params}}}),subscribe:()=>()=>{}} as unknown as GatewayClient;
    const port=createAmfProductionPort(client);
    await expect(port.reinspect("n3-test")).rejects.toMatchObject({code:"vua.amf_production.project_open",suggestedAction:"amf.production.closeEditor"});
    params={detail:"Close Unity first."};
    await expect(port.reinspect("n3-test")).rejects.toThrow("Close Unity first.");
    params={suggestedAction:"kill"};
    await expect(port.reinspect("n3-test")).rejects.toThrow("amf_production_error_invalid");
  });
  it("submits a confirmed close as a task with the caller's localized title", async () => {
    const requests: unknown[]=[];
    const client={invoke:async(request:unknown)=>{requests.push(request);return {ok:true,value:{schemaVersion:"0.1",runId:"n3-test",taskId:"task-close"}};},subscribe:()=>()=>{}} as unknown as GatewayClient;
    await expect(createAmfProductionPort(client).closeEditor("n3-test",true,"Save and close Unity")).resolves.toEqual({runId:"n3-test",taskId:"task-close"});
    expect(requests[0]).toMatchObject({method:"amf.production.closeEditor",params:{schemaVersion:"0.1",runId:"n3-test",confirmed:true}});
  });
  it("tolerates old absent removal facts and validates every new inventory and proof", async () => {
    const removal = JSON.parse(readFileSync(new URL("../../../../../schemas/unity-bridge/v5/examples/outfit-removal.valid.result.json", import.meta.url), "utf8")).data.outfitRemoval[0];
    expect(isAmfProductionRun(run)).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,outfitRemoval:[removal],outfitRemovalApplied:[]}}})).toBe(true);
    for (const invalid of [null,{},[removal,removal],[{...removal,objects:[{...removal.objects[0],manual:"yes"}]}]]) {
      expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,outfitRemoval:invalid}}})).toBe(false);
    }
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,outfitRemovalApplied:[{}]}}})).toBe(false);
    const plan = {schemaVersion:"0.1",runId:"n3-test",planDigest:"a".repeat(64),removal};
    let response: unknown = plan; const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){ requests.push(request); return {ok:true,value:response as DesktopGatewaySuccessValueV1}; },subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    const reviewed = await port.planOutfitRemoval("n3-test", "outfit");
    expect(requests[0]).toMatchObject({method:"amf.production.planOutfitRemoval",params:{sourceId:"outfit"}});
    response = {...plan,removal:{...removal,sourceId:"other"}};
    await expect(port.planOutfitRemoval("n3-test","outfit")).rejects.toThrow("removal_plan_invalid");
    response = {schemaVersion:"0.1",runId:"n3-test",taskId:"task-remove"};
    await port.removeOutfit("n3-test",reviewed,true);
    expect(requests.at(-1)).toMatchObject({method:"amf.production.removeOutfit",params:{sourceId:"outfit",planDigest:plan.planDigest,confirmed:true}});
    await expect(port.removeOutfit("n3-other",reviewed,true)).rejects.toThrow("confirmation_required");
  });
  it("accepts absent FT facts on old runs and validates new facts without claiming runtime success", () => {
    const faceTracking = JSON.parse(readFileSync(new URL("../../../../../schemas/unity-bridge/v5/examples/face-tracking.valid.result.json", import.meta.url), "utf8")).data.faceTracking;
    expect(isAmfProductionRun(run)).toBe(true);
    expect(isAmfProductionRun({ ...run, result: { facts: { ...run.result.facts, faceTracking } } })).toBe(true);
    for (const invalid of [null, {}, { ...faceTracking, runtime: "working" }, { ...faceTracking, patchMenus: "available" }]) {
      expect(isAmfProductionRun({ ...run, result: { facts: { ...run.result.facts, faceTracking: invalid } } })).toBe(false);
    }
  });
  it("refuses malformed results and preserves full Editor identity", () => {
    expect(isAmfProductionRun(run)).toBe(true);
    expect(isAmfProductionRun({...run,result:{facts:{...run.result.facts,instances:"passed"}}})).toBe(false);
    expect(isAmfProductionRun({...run,editor:{...run.editor,version:"2022.3.22"}})).toBe(false);
    expect(isAmfProductionRun({...run,choices:[{sourceId:"coat",role:"any-role"}]})).toBe(false);
    // A rejected run names the part that failed, for diagnosis.
    expect(amfRunProblem(run)).toBeNull();
    expect(amfRunProblem({...run,choices:[{sourceId:"coat",role:"any-role"}]})).toBe("choices");
    expect(amfRunProblem({...run,progress:{step:"unknown"}})).toBe("progress");
    expect(amfRunProblem(null)).toBe("record");
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
  it("reads the waiting work of the queue in its published shape", async () => {
    const list = {schemaVersion:"0.1",sources:[],editors:[],runs:[],busy:true,capacity:2,
      running:[{taskId:"task-check-a",runId:"n3-a",operation:"amf.production.reinspect"},{taskId:"task-check-b",runId:"n3-b",operation:"amf.production.reinspect"}],
      queue:[{taskId:"task-upload",runId:"n3-test",operation:"amf.production.upload"}]};
    let response: unknown = list;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.list()).queue).toEqual(list.queue);
    expect((await port.list()).running).toEqual(list.running);
    expect((await port.list()).capacity).toBe(2);
    for (const invalid of [{...list,capacity:4},{...list,capacity:1},{...list,busy:false},{...list,running:undefined}]) {
      response = invalid;
      await expect(port.list()).rejects.toThrow("list_invalid");
    }
    response = {...list,queue:[{taskId:"task-upload",runId:"n3-test",operation:"task.list"}]};
    await expect(port.list()).rejects.toThrow("list_invalid");
    const {queue: _missing, ...withoutQueue} = list; response = withoutQueue;
    await expect(port.list()).rejects.toThrow("list_invalid");
  });
  it("reads the BOOTH products each source maps to", async () => {
    const source = {sourceId:"cpy-1",itemId:"whi-1",itemName:"Meiyun.zip",name:"Meiyun.unitypackage"};
    const list = {schemaVersion:"0.1",sources:[{...source,productIds:["booth:4001"]},source],editors:[],runs:[],busy:false,capacity:1,running:[],queue:[]};
    let response: unknown = list;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.list()).sources.map(item => item.productIds ?? [])).toEqual([["booth:4001"], []]);
    for (const productIds of ["booth:4001", [""], [7]]) {
      response = {...list,sources:[{...source,productIds}]};
      await expect(port.list()).rejects.toThrow("list_invalid");
    }
  });
  it("reads optional recorded source digests without requiring them from older providers", async () => {
    const source = {sourceId:"cpy-1",itemId:"whi-1",itemName:"Synthetic.zip",name:"Avatar.unitypackage"};
    const digest = "a".repeat(64);
    const list = {schemaVersion:"0.1",sources:[{...source,sha256:digest},source],editors:[],runs:[],busy:false,capacity:1,running:[],queue:[]};
    let response: unknown = list;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.list()).sources.map(item => item.sha256)).toEqual([digest, undefined]);
    for (const sha256 of [null, 7, "", "a".repeat(63), "g".repeat(64), `sha256:${digest}`]) {
      response = {...list,sources:[{...source,sha256}]};
      await expect(port.list()).rejects.toThrow("list_invalid");
    }
  });
  it("sets capacity through the command and verifies the saved result", async () => {
    const requests: unknown[] = [];
    let result: unknown = {schemaVersion:"0.1",capacity:2};
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:result as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect(await port.setCapacity(2)).toBe(2);
    expect(requests[0]).toMatchObject({method:"amf.production.setCapacity",params:{schemaVersion:"0.1",capacity:2}});
    for (const invalid of [{schemaVersion:"0.1",capacity:1},{schemaVersion:"0.1",capacity:4},{}]) {
      result = invalid;
      await expect(port.setCapacity(2)).rejects.toThrow("capacity_invalid");
    }
  });
  it("reads the reviewed lighting plan and applies a chosen subset by its digest", async () => {
    const plan = {schemaVersion:"0.1",runId:"n3-test",planDigest:"b".repeat(64),
      reference:{min:"0.1",max:"1"},referenceReason:null,
      entries:[{material:"Assets/Outfit/Coat.mat",sourceId:"outfit",current:{min:"0.05",max:"1"},proposed:{min:"0.1",max:"1"}}],
      skipped:[{material:"Assets/Shared/Body.mat",reason:"shared_with_avatar"}]};
    let response: unknown = plan;
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    const reviewed = await port.planLighting("n3-test");
    expect(reviewed.entries[0]?.proposed.min).toBe("0.1");
    expect(requests[0]).toMatchObject({method:"amf.production.planLighting",params:{schemaVersion:"0.1",runId:"n3-test"}});
    for (const invalid of [{...plan,reference:null},{...plan,referenceReason:"tie",reference:{min:"0.1",max:"1"}},{...plan,planDigest:"z".repeat(64)},{...plan,entries:[{material:"Assets/Outfit/Coat.mat"}]}]) {
      response = invalid;
      await expect(port.planLighting("n3-test")).rejects.toThrow("lighting_plan_invalid");
    }
    response = {schemaVersion:"0.1",runId:"n3-test",taskId:"task-lighting"};
    await port.applyLighting("n3-test",reviewed,["Assets/Outfit/Coat.mat"]);
    expect(requests.at(-1)).toMatchObject({method:"amf.production.applyLighting",params:{schemaVersion:"0.1",runId:"n3-test",planDigest:plan.planDigest,materials:["Assets/Outfit/Coat.mat"]}});
    await expect(port.applyLighting("n3-other",reviewed,["Assets/Outfit/Coat.mat"])).rejects.toThrow("lighting_plan_invalid");
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
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.rollbackPlan("n3-test")).currentChanged).toBe(true);
    response = {...plan,preserveCurrent:false}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    response = {...plan,runId:"n3-other"}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    response = {...plan,snapshotId:""}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    await expect(port.rollback("n3-other",{...plan,preserveCurrent:true})).rejects.toThrow("restore_plan_invalid");
    // The pre-patch target is optional; present it must name a snapshot and its own digest.
    const prePatch = {snapshotId:"ft-snapshot-0",planDigest:"b".repeat(64)};
    response = {...plan,prePatch}; expect((await port.rollbackPlan("n3-test")).prePatch?.planDigest).toBe(prePatch.planDigest);
    response = {...plan,prePatch:{...prePatch,planDigest:"short"}}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    response = {...plan,prePatch:{...prePatch,snapshotId:""}}; await expect(port.rollbackPlan("n3-test")).rejects.toThrow("restore_plan_invalid");
    // Rolling back to it sends its digest and target; without the choice the default digest goes alone.
    response = {schemaVersion:"0.1",operation:"amf.production",runId:"n3-test",taskId:"task-restore"};
    await port.rollback("n3-test",{...plan,preserveCurrent:true,prePatch},"prePatch");
    expect(requests.at(-1)).toMatchObject({method:"amf.production.rollback",params:{schemaVersion:"0.1",runId:"n3-test",planDigest:prePatch.planDigest,target:"prePatch"}});
    await port.rollback("n3-test",{...plan,preserveCurrent:true,prePatch});
    expect(requests.at(-1)).toMatchObject({method:"amf.production.rollback",params:{schemaVersion:"0.1",runId:"n3-test",planDigest:plan.planDigest}});
    await expect(port.rollback("n3-test",{...plan,preserveCurrent:true},"prePatch")).rejects.toThrow("restore_plan_invalid");
  });
  it("accepts a run without revisions and rejects malformed revision items", () => {
    expect(isAmfProductionRun(run)).toBe(true);
    expect(amfRunProblem({...run,ftPrePatchSnapshot:"ft-snapshot-0"})).toBeNull();
    expect(amfRunProblem({...run,ftPrePatchSnapshot:null})).toBeNull();
    expect(amfRunProblem({...run,ftPrePatchSnapshot:""})).toBe("snapshotId");
    const revision = {id:"rev-1",before:"assembly",takenAt:"2026-10-18T00:00:00Z",editedInUnity:false,
      summary:{avatar:null,outfits:[],sources:["coat"],lightingMaterials:0,sdkFixes:[]}};
    expect(isAmfProductionRun({...run,revisions:[revision]})).toBe(true);
    expect(amfRunProblem({...run,revisions:[revision]})).toBeNull();
    expect(amfRunProblem({...run,revisions:"none"})).toBe("revisions");
    expect(amfRunProblem({...run,revisions:[{...revision,before:"everything"}]})).toBe("revisions");
    expect(amfRunProblem({...run,revisions:[{...revision,editedInUnity:"no"}]})).toBe("revisions");
    expect(amfRunProblem({...run,revisions:[{...revision,summary:{...revision.summary,lightingMaterials:-1}}]})).toBe("revisions");
    expect(amfRunProblem({...run,revisions:[{...revision,summary:{...revision.summary,avatar:7}}]})).toBe("revisions");
  });
  it("reads a revision plan and binds its restore to this run and revision", async () => {
    const plan = {schemaVersion:"0.1",runId:"n3-test",revisionId:"rev-1",planDigest:"c".repeat(64),before:"assembly" as const,takenAt:"2026-10-18T00:00:00Z",
      summary:{avatar:"Avatar",outfits:["Coat"],sources:["avatar","coat"],lightingMaterials:1,sdkFixes:[]},editedInUnity:true,warning:null,
      steps:[{key:"materials",skipped:false},{key:"assembly",skipped:false,rebuild:false},
        {key:"lighting",skipped:false,materials:[{material:"Assets/Coat.mat",min:"0.1",max:"1"}]},{key:"sdk_fix",skipped:true,fixes:[]}]};
    let response: unknown = plan;
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.revisionPlan("n3-test","rev-1")).editedInUnity).toBe(true);
    expect(requests[0]).toMatchObject({method:"amf.production.revisionPlan",params:{schemaVersion:"0.1",runId:"n3-test",revisionId:"rev-1"}});
    response = {...plan,planDigest:"z".repeat(64)}; await expect(port.revisionPlan("n3-test","rev-1")).rejects.toThrow("revision_plan_invalid");
    response = {...plan,before:"everything"}; await expect(port.revisionPlan("n3-test","rev-1")).rejects.toThrow("revision_plan_invalid");
    response = {...plan,revisionId:"rev-2"}; await expect(port.revisionPlan("n3-test","rev-1")).rejects.toThrow("revision_plan_invalid");
    const {steps: _missing, ...withoutSteps} = plan; response = withoutSteps;
    await expect(port.revisionPlan("n3-test","rev-1")).rejects.toThrow("revision_plan_invalid");
    response = {...plan,steps:[{key:"upload",skipped:false}]}; await expect(port.revisionPlan("n3-test","rev-1")).rejects.toThrow("revision_plan_invalid");
    await expect(port.restoreRevision("n3-other",plan)).rejects.toThrow("revision_plan_invalid");
    response = {schemaVersion:"0.1",operation:"amf.production.restoreRevision",runId:"n3-test",taskId:"task-restore"};
    await port.restoreRevision("n3-test",plan);
    expect(requests.at(-1)).toMatchObject({method:"amf.production.restoreRevision",params:{schemaVersion:"0.1",runId:"n3-test",revisionId:"rev-1",planDigest:plan.planDigest}});
  });
  it("accepts a run without fit data and rejects malformed fit entries", () => {
    expect(isAmfProductionRun(run)).toBe(true);
    const moved = {path:"Armature/Hips/Coat",localPosition:{x:0,y:0.1,z:0},localRotation:{x:0,y:0,z:0,w:1},localScale:{x:1,y:1,z:1}};
    const fitChanges = [{sourceId:"coat",moved:[moved],missing:["Armature/Hips/Old"],changesDigest:"b".repeat(64)}];
    const availableFits = [{sourceId:"coat",fitId:"fit-1",name:"Coat fit"}];
    expect(isAmfProductionRun({...run,fitChanges,availableFits})).toBe(true);
    expect(amfRunProblem({...run,fitChanges,availableFits})).toBeNull();
    expect(amfRunProblem({...run,fitChanges:"none"})).toBe("fitChanges");
    expect(amfRunProblem({...run,fitChanges:[{...fitChanges[0],changesDigest:"bad"}]})).toBe("fitChanges");
    expect(amfRunProblem({...run,fitChanges:[{...fitChanges[0],moved:[{...moved,localRotation:{x:0,y:0,z:0}}]}]})).toBe("fitChanges");
    expect(amfRunProblem({...run,fitChanges:[{...fitChanges[0],missing:"none"}]})).toBe("fitChanges");
    expect(amfRunProblem({...run,availableFits:"none"})).toBe("availableFits");
    expect(amfRunProblem({...run,availableFits:[{...availableFits[0],fitId:7}]})).toBe("availableFits");
  });
  it("saves, lists, renames and deletes fits as synchronous commands", async () => {
    const fit = {fitId:"fit-1",name:"Coat fit",createdAt:"2026-10-20T00:00:00Z",updatedAt:"2026-10-20T00:00:00Z"};
    const summary = {...fit,garment:{sha256:"a".repeat(64),prefabPath:"Assets/Coat.prefab",name:"Synthetic Coat"},
      avatar:{sha256:"b".repeat(64),prefabPath:"Assets/Avatar.prefab",name:"Synthetic Avatar"},objectCount:2};
    let response: unknown = {schemaVersion:"0.1",...fit};
    const requests: unknown[] = [];
    const client: GatewayClient = {async invoke(request){requests.push(request);return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.saveFit("n3-test","coat","Coat fit","b".repeat(64))).fitId).toBe("fit-1");
    expect(requests[0]).toMatchObject({method:"amf.production.saveFit",params:{schemaVersion:"0.1",runId:"n3-test",sourceId:"coat",name:"Coat fit",changesDigest:"b".repeat(64)}});
    response = {schemaVersion:"0.1",...fit,name:"Other"}; await expect(port.saveFit("n3-test","coat","Coat fit","b".repeat(64))).rejects.toThrow("save_fit_invalid");
    response = {schemaVersion:"0.1",...fit,createdAt:7}; await expect(port.saveFit("n3-test","coat","Coat fit","b".repeat(64))).rejects.toThrow("save_fit_invalid");
    response = {schemaVersion:"0.1",fits:[summary]};
    expect((await port.listFits())[0]?.objectCount).toBe(2);
    expect(requests.at(-1)).toMatchObject({method:"amf.production.listFits",params:{schemaVersion:"0.1"}});
    response = {schemaVersion:"0.1",fits:[{...summary,objectCount:-1}]}; await expect(port.listFits()).rejects.toThrow("fit_list_invalid");
    response = {schemaVersion:"0.1",fits:[{...summary,garment:{...summary.garment,sha256:"bad"}}]}; await expect(port.listFits()).rejects.toThrow("fit_list_invalid");
    response = {schemaVersion:"0.1",fits:"none"}; await expect(port.listFits()).rejects.toThrow("fit_list_invalid");
    response = {schemaVersion:"0.1",fitId:"fit-1",name:"Renamed fit"};
    expect(await port.renameFit("fit-1","Renamed fit")).toEqual({fitId:"fit-1",name:"Renamed fit"});
    expect(requests.at(-1)).toMatchObject({method:"amf.production.renameFit",params:{schemaVersion:"0.1",fitId:"fit-1",name:"Renamed fit"}});
    response = {schemaVersion:"0.1",fitId:"fit-2",name:"Renamed fit"}; await expect(port.renameFit("fit-1","Renamed fit")).rejects.toThrow("rename_fit_invalid");
    response = {schemaVersion:"0.1",fitId:"fit-1"};
    await port.deleteFit("fit-1");
    expect(requests.at(-1)).toMatchObject({method:"amf.production.deleteFit",params:{schemaVersion:"0.1",fitId:"fit-1"}});
    response = {schemaVersion:"0.1",fitId:"fit-2"}; await expect(port.deleteFit("fit-1")).rejects.toThrow("delete_fit_invalid");
  });
  it("tolerates an optional fit list on assembly plans", async () => {
    const plan = {schemaVersion:"0.1",runId:"n3-test",planDigest:"a".repeat(64),selection,inputs:[],editor:run.editor,projectRoot:run.projectRoot,preserveOriginals:true,officialSdkChecks:"not_run",
      fits:[{sourceId:"coat",fitId:"fit-1",name:"Coat fit"},{sourceId:"other",fitId:null,name:null}]};
    let response: unknown = plan;
    const client: GatewayClient = {async invoke(){return{ok:true,value:response as DesktopGatewaySuccessValueV1};},subscribe(){return()=>{};}};
    const port = createAmfProductionPort(client);
    expect((await port.plan("n3-test",selection)).fits?.[0]?.fitId).toBe("fit-1");
    const {fits: _missing, ...withoutFits} = plan; response = withoutFits;
    expect((await port.plan("n3-test",selection)).fits).toBeUndefined();
    response = {...plan,fits:[{sourceId:"coat",fitId:7,name:"Coat fit"}]}; await expect(port.plan("n3-test",selection)).rejects.toThrow("plan_invalid");
    response = {...plan,fits:"none"}; await expect(port.plan("n3-test",selection)).rejects.toThrow("plan_invalid");
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


describe("texture memory response boundary", () => {
  const textureMemory = JSON.parse(readFileSync(new URL("../../../../../schemas/unity-bridge/v5/examples/texture-memory.valid.result.json", import.meta.url), "utf8")).data.textureMemory;
  it("keeps old runs readable and validates all new platform facts", () => {
    expect(isAmfProductionRun(run)).toBe(true);
    const withFacts = (facts: unknown) => ({ ...run, result: { facts: { ...run.result.facts, textureMemory: facts } } });
    expect(isAmfProductionRun(withFacts(textureMemory))).toBe(true);
    for (const invalid of [null, {}, [textureMemory[0]], [{...textureMemory[0], totalBytes: -1}, textureMemory[1]],
      [{...textureMemory[0], textures: [{ ...textureMemory[0].textures[0], format: undefined }]}, textureMemory[1]]]) {
      expect(isAmfProductionRun(withFacts(invalid))).toBe(false);
    }
  });
});

describe("Avatar Optimizer response and export boundary", () => {
  const optimizerReport = JSON.parse(readFileSync(new URL("../../../../../schemas/unity-bridge/v5/examples/optimizer.valid.result.json", import.meta.url), "utf8")).data.optimizerReport;
  it("validates local-measurement-only optimizer reports, warnings, setOptimizer and vuar0.6 exports", async () => {
    expect(isAmfProductionRun({ ...run, optimizer: { enabled: true, packageVersion: "1.9.21" }, result: { facts: { ...run.result.facts, optimizerReport, optimizerWarnings: ["osc_gimmick_possible"] } } })).toBe(true);
    expect(isAmfProductionRun({ ...run, result: { facts: { ...run.result.facts, optimizerReport: { ...optimizerReport, localMeasurementOnly: false } } } })).toBe(false);
    const shareV06 = readFileSync(new URL("../../../../../schemas/amf-recipe/v0.6/share-examples/share.valid.json", import.meta.url), "utf8");
    const docV06 = JSON.parse(shareV06);
    const codeV06 = `vuar0.6.${Buffer.from(shareV06, "utf8").toString("base64url")}`;
    const requests: unknown[] = [];
    let response: unknown = { schemaVersion: "0.1", runId: "n3-test", taskId: "task-opt" };
    const client: GatewayClient = { async invoke(request) { requests.push(request); return { ok: true, value: response as DesktopGatewaySuccessValueV1 }; }, subscribe() { return () => {}; } };
    const port = createAmfProductionPort(client);
    expect(await port.setOptimizer("n3-test", true)).toEqual({ runId: "n3-test", taskId: "task-opt" });
    expect(requests[0]).toMatchObject({ method: "amf.production.setOptimizer", params: { schemaVersion: "0.1", runId: "n3-test", enabled: true } });
    response = { schemaVersion: "0.1", export: { shareCode: codeV06, fileText: shareV06, document: docV06 } };
    const exported = await port.exportRecipe("recipe-optimizer", "a".repeat(64), { "material-1": "1000001", "material-2": "1000001" });
    expect(exported.shareCode.startsWith("vuar0.6.")).toBe(true);
  });
});
