import { describe,expect,it } from "vitest";
import { createScenarioEnvironmentPort } from "./scenario-environment-port.ts";
import type { GatewayClient } from "./gateway-client.ts";
describe("scenario read port",()=>{
  it("never plans or executes as a side effect of reading steps/checks",async()=>{
    const methods:string[]=[];
    const client:GatewayClient={subscribe:()=>()=>{},invoke:async request=>{methods.push(request.method);return {ok:false,error:{kind:"unavailable"}};}};
    const port=createScenarioEnvironmentPort(client);
    await expect(port.sop({scenario:"pico_pcvr",connection:"usb"})).rejects.toThrow("unavailable");
    await expect(port.check({purposes:["pc_avatar"],editorRoot:"C:\\Editors"})).rejects.toThrow("unavailable");
    expect(methods).toEqual(["environment.getScenarioSop","environment.checkScenarioEnvironment"]);
  });
});
