// Run against --verify-extract output, never the user's installation or AI account.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {chromium} from 'playwright-core';
const root=path.resolve(process.argv[2]),dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-internal-'));
assert(root.includes(path.sep+'.test-data'+path.sep),'Use only an isolated extraction fixture');
const runtime=path.join(root,'runtime','node.exe'),data=path.join(dir,'data'),work=path.join(dir,'work'),log=path.join(dir,'calls.jsonl');
await fs.mkdir(work);await fs.writeFile(path.join(root,'installation.json'),JSON.stringify({channel:'internal',workFolder:work,access:'workspace-write',chromeSync:false}));
await fs.writeFile(path.join(dir,'app-server'),String.raw`const fs=require('fs'),rl=require('readline');let n=0;rl.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.ATLAS_FAKE_LOG,line+'\n');if(m.id===undefined)return;let result={};if(m.method==='model/list')result={data:[]};if(m.method==='thread/start')result={thread:{id:'fixture-'+(++n),cwd:m.params.cwd}};process.stdout.write(JSON.stringify({id:m.id,result})+'\n');});`);
let child,api,url,browser;
async function boot(fake){
 const env={...process.env,AI_WORKSPACE_DATA:data,LOCALAPPDATA:dir,USERPROFILE:dir,HOME:dir,CODEX_HOME:path.join(dir,'codex'),GPT_ATLAS_DESKTOP_SYNC:'0',AI_WORKSPACE_CODEX:fake?runtime:'',ATLAS_FAKE_LOG:log,OPENAI_API_KEY:'',GROQ_API_KEY:'',ATLAS_CHROME_SYNC:'0'};
 child=spawn(runtime,[path.join(root,'server/main.mjs')],{cwd:dir,windowsHide:true,env,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout '+errors)),10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('exit '+code+' '+errors));});createInterface({input:child.stdout}).once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});});
 url=new URL(ready.url);api=async(p,b)=>{const r=await fetch(url.origin+'/api'+p,{headers:{'x-workspace-token':url.hash.slice(1),'Content-Type':'application/json'},method:b===undefined?'GET':'POST',...(b===undefined?{}:{body:JSON.stringify(b)})});return {status:r.status,body:await r.json()};};
}
async function stop(){if(!child)return;const process=child;const exited=new Promise(resolve=>process.once('exit',resolve));await api('/shutdown',{}).catch(()=>{});await Promise.race([exited,new Promise(resolve=>setTimeout(()=>{process.kill();resolve();},2000).unref())]);child=null;}
try{
 await boot(false);
 assert.equal((await fetch(url.origin)).status,200);let state=(await api('/bootstrap')).body;
 assert.equal(state.defaultFolder,work);assert.equal(state.defaultAccess,'workspace-write');assert.equal(state.connected,false);
 assert.equal((await api('/connect',{})).status,500);
 const connection=(await api('/connections')).body;assert(connection.voice.every(v=>!v.configured));
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url.href);await page.locator('#new-task').waitFor();
 await page.locator('#app-menu summary').click();await page.locator('#settings-button').click();await page.locator('#default-access').selectOption('read-only');
 await page.waitForFunction(()=>document.querySelector('#default-access')?.value==='read-only');
 await page.waitForTimeout(150);assert.equal((await api('/bootstrap')).body.defaultAccess,'read-only');assert.deepEqual(errors,[]);
 await browser.close();browser=null;await stop();
 await boot(true);state=(await api('/bootstrap')).body;assert.equal(state.defaultAccess,'read-only');
 assert.equal((await api('/tasks',{title:'Read only'})).status,200);
 await api('/default-access',{access:'danger-full-access'});assert.equal((await api('/tasks',{title:'Full access'})).status,200);
 const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(x=>JSON.parse(x));const starts=calls.filter(x=>x.method==='thread/start');
 assert.equal(starts[0].params.sandbox,'read-only');assert.equal(starts[0].params.approvalPolicy,'on-request');assert.equal(starts[0].params.cwd,work);
 assert.equal(starts[1].params.sandbox,'danger-full-access');assert.equal(starts[1].params.approvalPolicy,'never');
 assert.equal((await api('/default-access',{access:'invalid'})).status,400);
 const saved=JSON.parse(await fs.readFile(path.join(data,'workspace.json'),'utf8'));assert.equal(saved.chromeSync,false);
 console.log('PASS: packaged Node, missing-Codex browser/UI, first-run folder/scope, permission UI/persistence, RPC permission defaults, no automatic bookmark or legacy voice-key import. No real AI requests.');
}finally{if(browser)await browser.close();await stop();}
