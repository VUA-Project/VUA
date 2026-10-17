import { app,BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {mkdir,writeFile} from "node:fs/promises";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const evidence=path.resolve(root,"../../docs/plans/_agent-local");
let server,window;
app.on("window-all-closed",()=>{});
async function main() {
try {
  await app.whenReady();server=await createServer({configFile:false,appType:"custom",root,plugins:[react()],server:{host:"127.0.0.1",port:0},optimizeDeps:{include:["react","react-dom/client","@vua/contracts"]}});
  server.middlewares.use(async(req,res,next)=>{if(req.url!=="/__agent")return next();res.setHeader("Content-Type","text/html");res.end(await server.transformIndexHtml(req.url,'<html data-theme="dark"><head><style>body{margin:0}#root{padding:24px;max-width:1000px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/ai-preparation.tsx"></script></body></html>'));});
  await server.listen();window=new BrowserWindow({show:false,width:1240,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
  window.webContents.on("console-message",event=>{if(event.level==="error")console.error(event.message);});
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__agent`);
  await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.agentUiReview){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(Error("fixture timeout"));}},40);})');
  const checks=await window.webContents.executeJavaScript("window.agentUiReview.run()");
  await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,"ui-result.json"),JSON.stringify({timestamp:new Date().toISOString(),scope:"Actual Chromium, synthetic ports only",checks},null,2));
  await writeFile(path.join(evidence,"unity-guide.png"),(await window.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({scope:"Actual Chromium, synthetic ports only",passed:checks.length,checks}));
  window.destroy();await server.close();app.exit(0);
}catch(error){console.error(error);window?.destroy();await server?.close();app.exit(1);}
}
void main();
