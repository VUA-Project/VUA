import { describe,expect,it } from "vitest";
import { readFileSync,readdirSync } from "node:fs";
import { isScenarioEnvironmentCheck,isScenarioSop } from "./scenario-environment.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isApplicationRequestV01 } from "./application-contract.js";
const root=new URL("../../../schemas/scenario-environment/v0.1/",import.meta.url);
const read=(name:string)=>JSON.parse(readFileSync(new URL(name,root),"utf8"));
describe("independent scenario Candidate boundaries",()=>{
  it("consumes all native request vectors through both gateways",()=>{
    for(const name of readdirSync(new URL("examples/",root))){const value=read(`examples/${name}`),expected=name.includes(".valid.");
      expect(isApplicationRequestV01(value),name).toBe(expected);
      // Desktop has no caller-controlled kind; an attempted command on the
      // application envelope is rejected there, not reinterpreted by Desktop.
      if(value.kind==="query")expect(isDesktopGatewayRequestV1({schemaVersion:1,requestId:value.requestId,method:value.method,params:value.params}),name).toBe(expected);
    }
  });
  it("accepts honest software facts and rejects license/installation claims",()=>{
    for(const name of readdirSync(new URL("results/",root)))expect(isScenarioEnvironmentCheck(read(`results/${name}`)),name).toBe(name.includes(".valid."));
    const value=read("results/check-ready.valid.json");
    expect(isScenarioEnvironmentCheck({...value,observations:[]})).toBe(false);
    expect(isScenarioEnvironmentCheck({...value,observations:[{...value.observations[0],presence:"missing"}]})).toBe(false);
    expect(isScenarioEnvironmentCheck({...value,nextAction:"plan_installation"})).toBe(false);
  });
  it("does not equate a static SOP with observed readiness",()=>{
    const value={schemaVersion:"vua.scenario-environment/v0.1",scenario:"desktop_play",connection:null,requirements:["steam","vrchat"],performed:"sop_only",nextAction:"check_environment",licenseRequiredFor:"none",
      steps:["check","install","launch"].map(id=>({id,title:"step",explanation:"explanation",expectedResult:"observed result",automatic:true}))};
    expect(isScenarioSop(value)).toBe(true);
    expect(isScenarioSop({...value,softwareReady:true})).toBe(false);
    expect(isScenarioSop({...value,licenseRequiredFor:"editor_execution"})).toBe(false);
    expect(isScenarioSop({...value,steps:[value.steps[0],value.steps[0],value.steps[1]]})).toBe(false);
  });
});
