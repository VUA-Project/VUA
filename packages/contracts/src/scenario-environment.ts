import { isDeploymentParams, type DeploymentIntent, type DeploymentPurpose } from "./environment-deployment.js";
export const SCENARIO_ENVIRONMENT_SCHEMA = "vua.scenario-environment/v0.1" as const;
export type ScenarioConnection = "usb" | "wifi";
export interface ScenarioSelection { readonly scenario: DeploymentPurpose; readonly connection?: ScenarioConnection | null }
export interface ScenarioSop { readonly schemaVersion: typeof SCENARIO_ENVIRONMENT_SCHEMA; readonly scenario: DeploymentPurpose;
  readonly connection: ScenarioConnection | null; readonly requirements: readonly string[];
  readonly steps: readonly { readonly id: string; readonly title: string; readonly explanation: string; readonly expectedResult: string; readonly automatic: boolean }[];
  readonly performed: "sop_only"; readonly nextAction: "check_environment"; readonly licenseRequiredFor: "editor_execution" | "none" }
export interface ScenarioEnvironmentCheck { readonly schemaVersion: typeof SCENARIO_ENVIRONMENT_SCHEMA; readonly intent: DeploymentIntent;
  readonly observations: readonly { readonly component: string; readonly presence: "verified" | "missing" | "unsuitable" | "detection_failed"; readonly location: string | null; readonly version: string | null }[];
  readonly softwareReady: boolean; readonly licenseState: "not_checked"; readonly performed: "software_check_only";
  readonly nextAction: "follow_sop" | "plan_installation"; readonly installationStarted: false }
export type ScenarioEnvironmentRequestV1 = {readonly schemaVersion:1;readonly requestId:string} & (
  {readonly method:"environment.getScenarioSop";readonly params:{readonly schemaVersion:"0.1";readonly scenario:ScenarioSelection}} |
  {readonly method:"environment.checkScenarioEnvironment";readonly params:{readonly schemaVersion:"0.1";readonly intent:DeploymentIntent}});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function scenarioRequiredComponents(purposes:readonly DeploymentPurpose[]):readonly string[] {
  const components:Record<DeploymentPurpose,readonly string[]>={desktop_play:["steam","vrchat"],pico_pcvr:["steam","vrchat","steamvr","pico_runtime"],pc_avatar:["unity_editor"],quest_avatar:["unity_editor","android_modules"]};
  return [...new Set(purposes.flatMap(p=>components[p]))].sort();
}
export function isScenarioSelection(v:unknown):v is ScenarioSelection {return record(v)&&["desktop_play","pico_pcvr","pc_avatar","quest_avatar"].includes(String(v.scenario))
  &&Object.keys(v).every(k=>k==="scenario"||k==="connection")&&(v.connection===undefined||v.connection===null||v.connection==="usb"||v.connection==="wifi")
  &&(v.scenario==="pico_pcvr"||v.connection===undefined||v.connection===null);}
export function isScenarioEnvironmentParams(method:unknown,v:unknown):boolean {if(!record(v)||v.schemaVersion!=="0.1"||Object.keys(v).length!==2)return false;
  return method==="environment.getScenarioSop"?isScenarioSelection(v.scenario):method==="environment.checkScenarioEnvironment"&&isDeploymentParams({intent:v.intent},false);}
export function isScenarioSop(v:unknown):v is ScenarioSop {
  if(!record(v)||!exact(v,["schemaVersion","scenario","connection","requirements","steps","performed","nextAction","licenseRequiredFor"])
    ||v.schemaVersion!==SCENARIO_ENVIRONMENT_SCHEMA||!isScenarioSelection({scenario:v.scenario,connection:v.connection}))return false;
  const required=scenarioRequiredComponents([v.scenario as DeploymentPurpose]);
  return Array.isArray(v.requirements)&&JSON.stringify(v.requirements)===JSON.stringify(required)&&Array.isArray(v.steps)&&v.steps.length>=3&&v.steps.length<=32
    &&v.steps.every(x=>record(x)&&exact(x,["id","title","explanation","expectedResult","automatic"])&&[x.id,x.title,x.explanation,x.expectedResult].every(t=>typeof t==="string"&&t.length>0)&&typeof x.automatic==="boolean")
    &&new Set(v.steps.map(x=>(x as Record<string,unknown>).id)).size===v.steps.length&&v.performed==="sop_only"&&v.nextAction==="check_environment"
    &&v.licenseRequiredFor===(["pc_avatar","quest_avatar"].includes(String(v.scenario))?"editor_execution":"none");
}
export function isScenarioEnvironmentCheck(v:unknown):v is ScenarioEnvironmentCheck {
  if(!record(v)||!exact(v,["schemaVersion","intent","observations","softwareReady","licenseState","performed","nextAction","installationStarted"])
    ||v.schemaVersion!==SCENARIO_ENVIRONMENT_SCHEMA||!isDeploymentParams({intent:v.intent},false)||!Array.isArray(v.observations))return false;
  const required=scenarioRequiredComponents((v.intent as DeploymentIntent).purposes);
  return v.observations.length===required.length&&v.observations.every((x,i)=>record(x)&&exact(x,["component","presence","location","version"])&&x.component===required[i]
    &&["verified","missing","unsuitable","detection_failed"].includes(String(x.presence))&&(x.location===null||typeof x.location==="string")&&(x.version===null||typeof x.version==="string"))
    &&v.softwareReady===v.observations.every(x=>(x as Record<string,unknown>).presence==="verified")&&v.licenseState==="not_checked"&&v.performed==="software_check_only"&&v.installationStarted===false
    &&v.nextAction===(v.softwareReady?"follow_sop":"plan_installation");
}
