// Actual Chromium; synthetic production port. No real-material gate claim.
import {app,BrowserWindow} from 'electron';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.resolve(root,'../../docs/plans/_n3-local');
let server,window;
app.on('window-all-closed',()=>{});
async function main(){
try{
 console.log('N3 DOM: waiting for Electron');
 await app.whenReady();console.log('N3 DOM: create server');server=await createServer({configFile:false,appType:'custom',root,plugins:[react()],server:{host:'127.0.0.1',port:0},optimizeDeps:{force:true,include:['react','react-dom/client','@vua/contracts']}});
 server.middlewares.use(async(req,res,next)=>{if(req.url!='/__n3')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><style>html,body,#root{height:100%;margin:0}#root{display:flex;padding:24px;box-sizing:border-box}</style></head><body><div id="root" data-module="production"></div><script type="module" src="/scripts/fixtures/amf-production.tsx"></script></body></html>'));});
 await server.listen();console.log('N3 DOM: load window');window=new BrowserWindow({show:false,width:1250,height:920,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
 window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
 await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__n3`);
 console.log('N3 DOM: fixture loaded');
 await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.n3Review){clearInterval(t);resolve();}else if(++n>150){clearInterval(t);reject(new Error("fixture load timeout"));}},50);})');
 const checks=await window.webContents.executeJavaScript('window.n3Review.run()');
 await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,'dom-check.json'),JSON.stringify({date:new Date().toISOString(),scope:'Chromium DOM, synthetic port only',checks},null,2));
 await writeFile(path.join(evidence,'dom-result.png'),(await window.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({scope:'Chromium DOM, synthetic port only',passed:checks.length,checks}));window.destroy();await server.close();app.exit(0);
}catch(error){console.error(error);window?.destroy();await server?.close();app.exit(1);}
}
void main();
