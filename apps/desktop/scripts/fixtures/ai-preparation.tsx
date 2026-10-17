// Synthetic ports in actual Chromium. No installer, account or Unity execution.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { GatewayProvider } from "../../src/renderer/gateway/GatewayProvider.tsx";
import { emptyGateway } from "../../src/renderer/gateway/empty-gateway.ts";
import { HelpPage } from "../../src/renderer/features/help/HelpPage.tsx";
import { AiRequestsHere } from "../../src/renderer/features/ai-requests/AiRequestsHere.tsx";
import { DeploymentPanel } from "../../src/renderer/features/deployer/DeploymentPanel.tsx";
import { AccountGuide } from "../../src/renderer/features/settings/AccountGuide.tsx";
import type { PageId } from "../../src/renderer/app/nav-model.ts";
import type { AiToolsSnapshotV01, DesktopAiToolsApiV01 } from "@vua/contracts";
import { strings } from "../../src/renderer/i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/features/deployer/deployer.css";
let snapshot: AiToolsSnapshotV01 = { schemaVersion: "0.1", enabled: false, endpoint: null, connections: 0, requests: [], error: null };
let copied = false, checks = 0, plans = 0, installs = 0, sopReads = 0, approved = false;
const listeners = new Set<(value: AiToolsSnapshotV01) => void>();
const aiTools: DesktopAiToolsApiV01 = {
  async snapshot() { return snapshot; },
  async setEnabled(enabled) { snapshot = { ...snapshot, enabled, endpoint: enabled ? "http://127.0.0.1:32179/mcp" : null }; listeners.forEach(fn => fn(snapshot)); return snapshot; },
  async prompt() { return "Synthetic MCP instructions — no real pairing token"; }, async copyPrompt() { copied = true; },
  async resolve(id, decision) { approved = decision === "approve"; snapshot = { ...snapshot, requests: snapshot.requests.map(r => r.id === id ? { ...r, state: approved ? "accepted" : "rejected" } : r) }; return snapshot; },
  subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
const base = emptyGateway(null);
const environment = { ...base.environment,
  scenarios: {
    async sop(selection: {scenario: "desktop_play"}) { sopReads++; return { schemaVersion: "vua.scenario-environment/v0.1" as const, ...selection, connection: null, requirements: ["steam","vrchat"], steps: ["check","install","launch"].map(id=>({ id, title:id, explanation:id, expectedResult:id, automatic:true })), performed:"sop_only" as const,nextAction:"check_environment" as const,licenseRequiredFor:"none" as const }; },
    async check(intent: any) { checks++; return { schemaVersion:"vua.scenario-environment/v0.1" as const,intent,observations:["steam","vrchat"].map(component=>({component,presence:"verified" as const,version:null,location:null})),softwareReady:true,licenseState:"not_checked" as const,performed:"software_check_only" as const,nextAction:"follow_sop" as const,installationStarted:false as const }; },
  },
  deployment: { async capability(){return {state:"ready" as const};},async plan(intent:any){plans++;return {schemaVersion:"vua.environment-deployment/v0.1" as const,intent,steps:[],digest:"a".repeat(64),prerequisitesReady:true,installer:null};},async execute(){installs++;return "task";},async status(){throw Error("not used");},async cancel(){},subscribe(){return()=>{};} },
};
function Fixture() {
  const [page,setPage] = useState<PageId>("help");
  return <GatewayProvider gateway={{...base,aiTools,environment} as any}>
    <AiRequestsHere page={page} />
    {page === "env-play" ? <DeploymentPanel zone="play" purpose="desktop_play" /> : page === "settings-accounts" ? <AccountGuide account="unity" onBack={()=>setPage("help")} />
      : <HelpPage page={page as any} navigate={setPage} onAccounts={()=>{}} startTour={()=>{}} guideRequest={null} acknowledgeGuide={()=>{}} />}
    <button id="to-preparation" onClick={()=>setPage("env-play")}>Test preparation</button>
    <button id="to-license" onClick={()=>setPage("settings-accounts")}>Test license</button>
  </GatewayProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
const wait=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
async function until(predicate:()=>boolean){for(let i=0;i<120;i++){if(predicate())return;await wait();}throw Error("UI state timeout");}
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===text);
Object.assign(window,{agentUiReview:{async run(){ const passed:string[]=[]; const assert=(value:unknown,name:string)=>{if(!value)throw Error(name);passed.push(name);};
  await until(()=>!!button(strings.aiTools.title));button(strings.aiTools.title)!.click();await until(()=>!!button(strings.aiTools.enable));
  assert(!document.querySelector("textarea"),"No pairing token is shown before enabling");
  button(strings.aiTools.enable)!.click();await until(()=>!!document.querySelector("textarea"));
  button(strings.aiTools.copy)!.click();await until(()=>copied);
  assert(copied,"The copy action uses the host pairing port");
  document.documentElement.dataset.theme="light";await wait();
  const field=document.querySelector("textarea")!;
  assert(getComputedStyle(field).color!==getComputedStyle(field).backgroundColor,"Prompt remains readable in light appearance");
  document.documentElement.dataset.theme="dark";
  snapshot={...snapshot,requests:[{id:"synthetic",tool:"vua_request_play",title:"Start",explanation:"Review",expectedResult:"Game opens",createdAt:new Date().toISOString(),state:"pending",details:{parameters:{route:"desktop_play",action:"start"}}}]};listeners.forEach(fn=>fn(snapshot));
  await until(()=>!!button(strings.aiTools.goConfirm));
  assert(!button(strings.aiTools.approve),"Help lists the request and sends the player to the page it changes");
  button(strings.aiTools.goConfirm)!.click();await until(()=>!!button(strings.aiTools.approve));
  assert(!approved,"Incoming action waits for a local click");button(strings.aiTools.approve)!.click();await until(()=>approved);
  await until(()=>document.body.textContent!.includes(strings.aiTools.dispatchedHint));
  assert(document.body.textContent!.includes(strings.aiTools.dispatchedHint),"Dispatch is explained separately from completion");
  document.getElementById("to-preparation")!.click();await until(()=>!!button(strings.scenarioEnvironment.sop));
  button(strings.scenarioEnvironment.sop)!.click();await until(()=>sopReads===1);await wait();
  assert(checks===0&&plans===0&&installs===0,"Reading steps performs no check, plan or installation");
  button(strings.scenarioEnvironment.check)!.click();await until(()=>checks===1);await until(()=>document.body.textContent!.includes(strings.scenarioEnvironment.done));
  assert(plans===0&&installs===0,"Software checks remain separate from installation");
  button(strings.scenarioEnvironment.plan)!.click();await until(()=>plans===1);
  assert(installs===0,"Installation planning does not execute");
  document.getElementById("to-license")!.click();await until(()=>document.body.textContent!.includes(strings.unityLicense.activate));
  assert(document.querySelectorAll("ol li").length===5,"Unity guide explains registration, Hub, activation, reuse and return");
  return passed;
}}});
