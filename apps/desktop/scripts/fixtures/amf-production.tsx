import { catalogBrowser } from "../../src/renderer/app/catalog-browser-instance.ts";
import { decodeAmfRecipeShare, type AmfSharedRecipe } from "@vua/contracts";
// Synthetic browser state checks only; no Unity/material acceptance.
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {GatewayProvider} from "../../src/renderer/gateway/GatewayProvider.tsx";
import {emptyGateway} from "../../src/renderer/gateway/empty-gateway.ts";
import {AmfProductionPage} from "../../src/renderer/features/amf/AmfProductionPage.tsx";
import {RecipePage} from "../../src/renderer/features/recipe/RecipePage.tsx";
import type {AmfProductionRun,AmfProductionPort,AmfSavedRecipe} from "../../src/renderer/gateway/index.ts";
import type {AmfAssemblySelection} from "@vua/contracts";
import {strings} from "../../src/renderer/i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

localStorage.removeItem("vua-amf-production-run-v01");localStorage.removeItem("vua-amf-production-materials-v01");
const copy=strings.amfProduction;
const sources=[{sourceId:"avatar",itemId:"item-avatar",itemName:"Synthetic Avatar",name:"PC/Avatar.unitypackage"},
  {sourceId:"outfit",itemId:"item-outfit",itemName:"Synthetic Coat",name:"Clothes/Coat.unitypackage"}];
let shared:AmfSharedRecipe|null=null;let imported=false;let copied=false;let fileSaved=false;
Object.defineProperty(window,"vua",{value:{dialog:{async copyRecipeShare(document:AmfSharedRecipe){if(document!==shared)throw Error("Wrong copied declaration");copied=true;},async saveRecipeShare(document:AmfSharedRecipe){if(document!==shared)throw Error("Wrong file declaration");fileSaved=true;return true;}}}});
catalogBrowser.list=async()=>({schemaVersion:1,kind:"results",total:1,items:[{productId:"booth:1000001",title:"Synthetic product",libraryType:"bought",importedArtifacts:1,shopName:null,variantName:null,price:null,imageUrl:null,imageUrls:[],availability:"unknown",availabilityRaw:null,entityCount:0,entityTypes:[]}],vocabulary:{availabilities:[],entityTypes:[],relationKinds:[]}});
let selected:AmfAssemblySelection|null=null;
let prepared=false;let assembled=false;let restored=false;let recipePrepared=false;let saved:AmfSavedRecipe|null=null;
const applicationChoices:string[]=[];
let run:AmfProductionRun={schemaVersion:"0.1",runId:"n3-dom",phase:"ready",taskId:"n3-task",editor:{path:"C:/Unity/Unity.exe",version:"2022.3.22f1c1"},projectRoot:"C:/Synthetic/work",
  choices:[],sources:sources.map(s=>({...s,role:"auto",sha256:"a".repeat(64)})),
  prefabs:[{sourceId:"avatar",path:"Assets/Avatar.prefab",name:"Synthetic Avatar",isAvatar:true,hasSkinnedMesh:true,hasMergeArmature:false,hasMissingScripts:false,humanoidBones:["Head"]},
    {sourceId:"outfit",path:"Assets/Coat.prefab",name:"Synthetic Coat",isAvatar:false,hasSkinnedMesh:true,hasMergeArmature:false,hasMissingScripts:false,humanoidBones:[]}],
  steps:[],selection:null,error:null,recovery:null,result:null,snapshotId:null};
const api:AmfProductionPort={
  async recipeApplyPlan(runId,recipeId,avatarGlobalObjectId){
    if(!selected||!saved)throw Error("Missing synthetic observation");
    return {runId,recipeId,title:saved.recipe.title,avatarName:avatarGlobalObjectId==="synthetic-original"?"Original Avatar":"Synthetic Avatar",avatarGlobalObjectId:avatarGlobalObjectId??"synthetic-avatar",planDigest:"d".repeat(64),retainedOutfits:0,overlayBlocker:null,
      targets:[{globalObjectId:"synthetic-avatar",name:"Synthetic Avatar",verified:true},{globalObjectId:"synthetic-original",name:"Original Avatar",verified:true}],
      currentSelection:selected,recipeSelection:{...selected,outfits:selected.outfits.map(o=>({...o,active:!o.active}))},
      conflicts:[{sourceId:"outfit",packageName:"Coat.unitypackage",field:"active",current:selected.outfits[0]!.active,incoming:!selected.outfits[0]!.active}]};
  },
  async applyRecipe(plan,choice){
    if(plan.planDigest!=="d".repeat(64))throw Error("Missing reviewed comparison");
    applicationChoices.push(choice);selected=choice==="avatar_wins"?plan.currentSelection:plan.recipeSelection;
    run={...run,phase:"succeeded",selection:selected,result:{facts:{sdkDescriptorRecognized:true,missingReferences:0,avatarName:"Synthetic Avatar",observedSelection:selected,instances:[{sourceId:"outfit",bindingVerified:true,menuVerified:true,menuModified:true}]}}};
    return{runId:run.runId,taskId:"n3-task"};
  },
  async recipeSharePlan(recipeId){if(!saved)throw Error("Recipe missing");return{recipeId,title:saved.recipe.title,revision:1,planDigest:"c".repeat(64),materials:saved.recipe.materials.map(m=>({materialId:m.id,packageName:m.packageName,candidates:[],selectedProductId:null}))};},
  async exportRecipe(recipeId,digest,sources){if(!saved||recipeId!==saved.recipe.recipeId||digest!=="c".repeat(64)||Object.keys(sources).length!==2||Object.values(sources).some(id=>id!=="1000001"))throw Error("Source confirmation missing");shared={formatVersion:"0.4",recipe:structuredClone(saved.recipe),sources};return{document:shared,fileText:JSON.stringify(shared),shareCode:"vuar0.4."+btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(shared)))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")};},
  async previewRecipeShare(text){const value=decodeAmfRecipeShare(text);if(!value)throw Error("Invalid share text");return value;},
  async importRecipe(text){if(!decodeAmfRecipeShare(text)||!saved)throw Error("Invalid share");imported=true;return saved;},
  async listRecipes(){return saved?[{recipeId:saved.recipe.recipeId,title:saved.recipe.title,revision:saved.revision,updatedAt:saved.updatedAt}]:[];},
  async getRecipe(id){if(!saved||saved.recipe.recipeId!==id)throw new Error("Recipe missing");return structuredClone(saved);},
  async saveRecipe(_runId,title){if(!selected)throw new Error("Nothing assembled");saved={revision:1,updatedAt:"2026-10-15T00:00:00Z",recipe:{formatVersion:"0.4",recipeId:"recipe-dom",title,editorVersion:"2022.3.22f1c1",materials:[{id:"m-"+"a".repeat(64),packageName:"Avatar.unitypackage",sha256:"a".repeat(64)},{id:"m-"+"b".repeat(64),packageName:"Coat.unitypackage",sha256:"b".repeat(64)}],avatar:{materialId:"m-"+"a".repeat(64),prefabPath:"Assets/Avatar.prefab"},outfits:selected.outfits.map(o=>({materialId:"m-"+"b".repeat(64),prefabPath:o.prefabPath,mode:o.mode,bone:o.bone,toggleName:o.toggleName,active:o.active})),packages:{"com.vrchat.avatars":"3.10.5","nadena.dev.modular-avatar":"1.18.7"}}};return structuredClone(saved);},
  async prepareRecipe(id){if(!saved||saved.recipe.recipeId!==id)throw new Error("Wrong Recipe");recipePrepared=true;run={...run,runId:"n3-recipe-dom",phase:"ready",selection:selected,result:null};return{runId:run.runId,taskId:"n3-task"};},
  async list(){return{sources,editors:[run.editor],runs:[],busy:false};},
  async get(){return structuredClone(run);},
  async prepare(choices){if(choices.length!==2||choices.some(s=>s.role!=="auto"))throw new Error("nonautomatic inputs");prepared=true;return{runId:run.runId,taskId:"n3-task"};},
  async plan(runId,selection){selected=selection;return{runId,planDigest:"a".repeat(64),selection,inputs:[{sourceId:"avatar",name:"Synthetic Avatar",role:"avatar"},{sourceId:"outfit",name:"Synthetic Coat",role:"outfit"}]};},
  async assemble(){assembled=true;run={...run,phase:"succeeded",selection:selected,snapshotId:"n3-snapshot",result:{facts:{sdkDescriptorRecognized:true,missingReferences:0,avatarName:"Synthetic Avatar",observedSelection:selected,instances:[{sourceId:"outfit",bindingVerified:true,menuVerified:true,menuModified:true}]}}};return{runId:run.runId,taskId:"n3-task"};},
  async reinspect(){
    if(!selected||!run.result?.facts)throw new Error("No retained scene to inspect");
    run={...run,phase:"ready",result:{facts:{...run.result.facts,observedSelection:{...selected,outfits:selected.outfits.map(o=>({...o,toggleName:"Unity edited coat",active:false}))}}}};
    return{runId:run.runId,taskId:"n3-task"};
  },async open(){return{runId:run.runId,taskId:"n3-task"};},
  async rollbackPlan(runId){return{runId,planDigest:"b".repeat(64),snapshotId:"n3-snapshot",projectRoot:run.projectRoot,currentChanged:true,preserveCurrent:true};},
  async rollback(runId,plan){if(plan.planDigest!=="b".repeat(64))throw new Error("restore was not reviewed");restored=true;run={...run,phase:"ready",selection:null,result:null,snapshotId:"n3-current-protected"};return{runId,taskId:"n3-task"};},
};
const gateway=emptyGateway(null);
function ReviewApp(){
  const [page,setPage]=useState("recipe");
  return page==="recipe"?<RecipePage onNavigate={setPage}/>:<AmfProductionPage onNavigate={setPage} onPrepareEnv={()=>{}}/>;
}
createRoot(document.getElementById("root")!).render(<GatewayProvider gateway={{...gateway,amfProduction:api,task:{...gateway.task,async snapshot(){return{schemaVersion:1,tasks:[{id:"n3-task",title:"Synthetic action",status:"completed",originPage:"workshop",cancellable:false}]};}}}}>
  <ReviewApp/></GatewayProvider>);
const wait=(ms=50)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
let lastCheck="initial render";
async function until(predicate:()=>boolean){for(let i=0;i<100;i++){if(predicate())return;await wait();}throw new Error("DOM state timeout after "+lastCheck+"; alert: "+document.querySelector("[role=alert]")?.textContent+"; buttons: "+[...document.querySelectorAll("button")].map(b=>b.textContent?.trim()+"[disabled="+b.disabled+"]").join(" / ")+"; copied="+copied+"; fileSaved="+fileSaved+"; caller="+new Error().stack);}
const button=(title:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===title);
const check=(test:unknown,title:string,checks:string[])=>{if(!test)throw new Error(title);checks.push(title);lastCheck=title;};
Object.assign(window,{n3Review:{async run(){const checks:string[]=[];
  await until(()=>!!button(copy.recipeMakeAvatar));
  check(!!button(copy.importRecipe)&&!document.body.textContent?.includes(strings.recipe.notConnectedTitle),"Recipe entry leads with saved production and import",checks);
  button(copy.recipeMakeAvatar)?.click();
  await until(()=>document.querySelectorAll(".vua-n3__material").length===2);
  check(document.querySelectorAll("input[type=search]").length===1,"material-first entry with no project name form",checks);
  [...document.querySelectorAll<HTMLInputElement>(".vua-n3__material input")].forEach(input=>input.click());await wait();
  button(copy.prepare)?.click();await until(()=>!!button(copy.reviewCta)&&!button(copy.reviewCta)?.disabled);
  check(prepared,"prepare selected packages with automatic roles",checks);
  check(!document.body.textContent?.includes(copy.chooseAvatar),"unique observed Avatar needs no extra selection question",checks);
  check(document.querySelectorAll(".vua-n3__outfit input:not([type=checkbox])").length===1,"one outfit switch is editable",checks);
  button(copy.reviewCta)?.click();await until(()=>!!button(copy.confirm));
  check(selected?.avatarPrefab==="Assets/Avatar.prefab"&&selected.outfits.length===1,"review uses exact observed targets",checks);
  button(copy.confirm)?.click();await until(()=>!!button(copy.open)&&!button(copy.open)?.disabled);
  check(assembled,"human terminal task status clears pending controls",checks);
  check(document.body.textContent?.includes(copy.sdkNotRun),"SDK checks stay honestly not run",checks);
  check(document.querySelectorAll(".vua-n3__checks li").length===3,"only returned relationship facts get check marks",checks);
  button(copy.continueEditing)?.click();await until(()=>!!button(copy.reviewCta)&&!button(copy.reviewCta)?.disabled);
  check(document.querySelector<HTMLInputElement>(".vua-n3__outfit input:not([type=checkbox])")?.value==="Unity edited coat","continued editing starts from observed Unity changes",checks);
  check(document.querySelector<HTMLInputElement>(".vua-n3__outfit input[type=checkbox]")?.checked===false,"observed inactive state is not overwritten by old confirmation",checks);
  button(copy.restore)?.click();await until(()=>!!button(copy.restoreConfirm));
  check(!restored&&document.body.textContent?.includes(copy.restoreChanged),"restore review discloses newer edits before any mutation",checks);
  check(document.body.textContent?.includes(copy.restoreReversible),"restore review promises protection of current work",checks);
  button(copy.back)?.click();await until(()=>!!button(copy.restore));
  check(!restored,"leaving a restore review does not change the project",checks);
  button(copy.restore)?.click();await until(()=>!!button(copy.restoreConfirm));
  button(copy.restoreConfirm)?.click();await until(()=>!!document.body.textContent?.includes(copy.restored));
  check(restored&&!!button(copy.reviewCta)&&!!button(copy.restore),"restored work can be edited or restored again",checks);
  button(copy.reviewCta)?.click();await until(()=>!!button(copy.confirm));button(copy.confirm)?.click();await until(()=>!!button(copy.saveRecipe));
  button(copy.saveRecipe)?.click();await until(()=>!!button(copy.recipes));
  check(saved!==null,"actual production settings can be saved as a Recipe",checks);
  button(copy.recipes)?.click();await until(()=>document.querySelectorAll(".vua-n3__recipe").length===1);
  (document.querySelector(".vua-n3__recipe") as HTMLButtonElement).click();await until(()=>!!button(copy.recipeReproduce));
  check(document.body.textContent?.includes("Avatar.unitypackage"),"saved Recipe reopens its material references",checks);
  check(document.querySelectorAll(".vua-n3__material").length===0,"Recipe review shows one preparation path",checks);
  button(copy.shareRecipe)?.click();await until(()=>!!button(copy.shareExport));
  check(button(copy.shareExport)?.disabled,"sharing waits for missing source statements",checks);
  await until(()=>!!button(copy.sourceUse));button(copy.sourceUse)?.click();await until(()=>!button(copy.shareExport)?.disabled);
  check(document.querySelectorAll(".vua-recipe-transfer__materials li").length===0,"one product can fill all selected missing sources",checks);
  button(copy.shareExport)?.click();await until(()=>!!button(copy.shareCopy)&&!button(copy.shareCopy)?.disabled);
  check(shared?.recipe.materials.length===2&&Object.keys(shared.sources).length===2,"sharing exports only declared materials",checks);
  button(copy.shareCopy)?.click();await until(()=>copied&&!!document.body.textContent?.includes(copy.shareCopied));await wait();await until(()=>!button(copy.shareDownload)?.disabled);check(copied,"clipboard receives the reviewed declaration",checks);button(copy.shareDownload)?.click();await until(()=>fileSaved);
  check(copied&&fileSaved,"file and clipboard use the same reviewed declaration",checks);
  document.querySelector<HTMLButtonElement>(".vua-content-dialog__close")?.click();await until(()=>!document.querySelector("[role=dialog]"));
  button(copy.back)?.click();await until(()=>!!button(copy.importRecipe));
  button(copy.importRecipe)?.click();await until(()=>!!button(copy.importPreview));
  const paste=document.querySelector<HTMLTextAreaElement>(".vua-recipe-transfer textarea")!;
  const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!;
  setter.call(paste,JSON.stringify(shared));paste.dispatchEvent(new Event("input",{bubbles:true}));await wait();
  button(copy.importPreview)?.click();await until(()=>!!button(copy.importSave));
  check(!imported&&!recipePrepared,"received declarations are previewed before saving or execution",checks);
  check(!document.querySelector(".vua-recipe-transfer textarea")&&!!button(copy.importEdit),"import review shows readable contents and can return to editing",checks);
  button(copy.importEdit)?.click();await until(()=>!!button(copy.importPreview));
  check(!imported&&document.querySelector<HTMLTextAreaElement>(".vua-recipe-transfer textarea")?.value===JSON.stringify(shared),"changing a reviewed Recipe preserves the input without saving",checks);
  button(copy.importPreview)?.click();await until(()=>!!button(copy.importSave));
  button(copy.importSave)?.click();await until(()=>!!document.body.textContent?.includes(copy.importDone));
  check(imported&&!recipePrepared,"import saves the declaration without preparing Unity",checks);
  button(copy.recipeOpen)?.click();await until(()=>!document.querySelector("[role=dialog]")&&!!button(copy.recipeReproduce));

  button(copy.recipeReproduce)?.click();await until(()=>!!button(copy.reviewCta)&&!button(copy.reviewCta)?.disabled);
  check(recipePrepared&&!!button(copy.reviewCta)&&!button(copy.open),"Recipe reproduction still requires review before assembly",checks);
  button(copy.reviewCta)?.click();await until(()=>!!button(copy.confirm));button(copy.confirm)?.click();await until(()=>!!button(copy.applyRecipe));
  button(copy.applyRecipe)?.click();await until(()=>!!document.querySelector("[role=dialog] .vua-n3__recipe"));
  document.querySelector<HTMLButtonElement>("[role=dialog] .vua-n3__recipe")?.click();await until(()=>!!button(copy.applyConfirm));
  check(document.querySelector<HTMLInputElement>('input[value="new_avatar"]')?.checked&&document.querySelectorAll(".vua-recipe-apply__table tbody tr").length===1,"existing Avatar review shows actual differences and recommends a new Avatar",checks);
  const targetSelect=document.querySelector<HTMLSelectElement>("[role=dialog] select")!;targetSelect.value="synthetic-original";targetSelect.dispatchEvent(new Event("change",{bubbles:true}));
  await until(()=>!!document.querySelector("[role=dialog] h3")?.textContent?.includes("Original Avatar"));
  check(document.querySelector<HTMLSelectElement>("[role=dialog] select")?.value==="synthetic-original"&&applicationChoices.length===0,"selecting an older Avatar refreshes its comparison without execution",checks);
  button(copy.applyCancel)?.click();await until(()=>!document.querySelector("[role=dialog]"));
  check(applicationChoices.length===0,"cancelling Recipe application makes no execution call",checks);
  button(copy.applyRecipe)?.click();await until(()=>!!document.querySelector("[role=dialog] .vua-n3__recipe"));
  document.querySelector<HTMLButtonElement>("[role=dialog] .vua-n3__recipe")?.click();await until(()=>!!button(copy.applyConfirm));
  document.querySelector<HTMLInputElement>('input[value="avatar_wins"]')?.click();await wait();button(copy.applyConfirm)?.click();
  await until(()=>!document.querySelector("[role=dialog]")&&applicationChoices.length===1);
  check(applicationChoices[0]==="avatar_wins","only the explicitly selected conflict behavior is executed",checks);
  document.documentElement.dataset.theme="light";await wait(250);
  const color=getComputedStyle(document.querySelector(".vua-n3 h2")!).color;
  check(color!=="rgba(0, 0, 0, 0)","light appearance retains readable fields",checks);
  return checks;
}}});
