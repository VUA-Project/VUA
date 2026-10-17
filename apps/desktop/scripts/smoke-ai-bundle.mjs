// Bundle the same MCP implementation as Main and forbid node_modules loads from
// that artifact. This detects development-only dependencies and browser stubs.
import { build } from "vite";
import { builtinModules, createRequire, Module } from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {assertBundledRuntime} from "./bundled-runtime.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const workspace=path.resolve(root,"../..");
const evidence=path.join(workspace,"docs/plans/_agent-local/bundle");
await mkdir(evidence,{recursive:true});
await build({configFile:false,publicDir:false,root,resolve:{conditions:["node"],alias:{
  ...Object.fromEntries(builtinModules.filter(name=>!name.startsWith("node:")).map(name=>[name,`node:${name}`])),
  "@vua/contracts":path.join(workspace,"packages/contracts/src/index.ts"),
}},build:{outDir:evidence,emptyOutDir:false,target:"node24",minify:false,sourcemap:false,
  lib:{entry:path.join(root,"src/electron/ai-tools-server.ts"),formats:["cjs"],fileName:()=>"ai-tools.cjs"},rolldownOptions:{platform:"node",external:[/^node:/]},}});
const bundle=path.join(evidence,"ai-tools.cjs");
assertBundledRuntime(await readFile(bundle,"utf8"),"main");
const originalLoad=Module._load;
Module._load=function(request,parent,...rest){
  if(parent?.filename===bundle&&!request.startsWith("node:"))throw Error("Unbundled dependency reached the packaged MCP artifact");
  return originalLoad.call(this,request,parent,...rest);
};
let service;
const checks=[];
try {
  const {AiToolsServer}=createRequire(import.meta.url)(bundle);
  const token=randomBytes(32).toString("base64url");
  service=new AiToolsServer({version:"bundle-test",port:0,load:()=>({enabled:false,token}),save:()=>{},invoke:async request=>({schemaVersion:1,requestId:request.requestId,ok:true,value:{marker:"actual packaged tool dispatch",method:request.method}})});
  await service.setEnabled(true);if(!service.snapshot().enabled)throw Error("Bundled server did not start");
  // The session-based HTTP adapter uses the compatible initialize handshake.
  // SDK v2's new per-request 2026 interface is a separate transport surface.
  for(const era of ["2025-11-25","2025-06-18"]){
    const transport=new StreamableHTTPClientTransport(new URL(service.snapshot().endpoint),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
    const client=new Client({name:"package acceptance",version:"1"},{supportedProtocolVersions:[era]});
    try {await client.connect(transport);await client.listTools();
      const reply=await client.callTool({name:"vua_sop",arguments:{scenario:"desktop_play"}});
      if(reply.isError||reply.structuredContent?.data?.marker!=="actual packaged tool dispatch")throw Error("Bundled transport/validator did not dispatch");
      checks.push(`${era} initialization and tool call with no external module loads`);
    }finally{await transport.terminateSession().catch(()=>{});await client.close();}
  }
  await writeFile(path.join(evidence,"result.json"),JSON.stringify({timestamp:new Date().toISOString(),scope:"Actual bundled MCP, synthetic Gateway only",checks},null,2));
  console.log(JSON.stringify({scope:"Actual bundled MCP, synthetic Gateway only",passed:checks.length,checks}));
}finally{await service?.dispose();Module._load=originalLoad;}
