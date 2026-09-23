import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-service-recovery-'));
const env={...process.env,AI_WORKSPACE_DATA:dir,AI_WORKSPACE_CODEX:process.execPath,CODEX_HOME:path.join(dir,'codex'),LOCALAPPDATA:dir,GPT_ATLAS_DESKTOP_SYNC:'0',ATLAS_FRESH_SESSION:'0'};
delete env.ATLAS_SERVICE_PORT;delete env.ATLAS_SERVICE_TOKEN;
let child,browser;
async function start(extra={}){
 child=spawn(process.execPath,['server/main.mjs'],{env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',()=>{});
 return await Promise.race([new Promise(resolve=>createInterface({input:child.stdout}).once('line',s=>resolve(JSON.parse(s)))),once(child,'exit').then(()=>{throw Error('Fixture service failed')})]);
}
try{
 const ready=await start();const url=new URL(ready.url),token=url.hash.slice(1);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
 const task={id:'quota-fixture',title:'Quota fixture',cwd:dir,hasConversation:true,state:'completed',activeTurn:null,edits:[],artifacts:[],events:[]};
 await page.route('**/api/bootstrap',async route=>{const res=await route.fetch(),b=await res.json();b.tasks=[task];b.connected=true;b.account={type:'chatgpt'};if(!b.ui.active)b.ui={...b.ui,active:task.id,open:[task.id],viewTabs:[{kind:'task',id:task.id,key:'task:'+task.id}],activeView:'task:'+task.id,appearanceVersion:3,drafts:{}};await route.fulfill({response:res,json:b});});
 let sends=0;
 await page.route('**/api/tasks/quota-fixture/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/send')){sends++;await route.fulfill({status:429,json:{error:'Limit reached',codexErrorInfo:'UsageLimitExceeded'}});return;}
  await route.fulfill({json:u.pathname.endsWith('/history')?{data:[],nextCursor:null}:u.pathname.endsWith('/files')?{files:[]}:task});
 });
 await page.goto(ready.url);await page.locator('#task-title').waitFor({timeout:15000});
 await page.locator('#composer-toggle').click();
 await page.locator('#prompt').fill('KEEP THIS UNSENT JAPANESE DRAFT 日本語');
 await page.locator('#composer').evaluate(form=>form.requestSubmit());
 await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('利用上限'));
 assert.equal(sends,1);assert.match(await page.locator('#prompt').inputValue(),/KEEP THIS/);
 await page.locator('#new-note').evaluate(el=>el.dataset.identity='keep-dom');
 const exited=once(child,'exit');child.kill();await exited;
 await page.waitForFunction(()=>document.querySelector('#usage-button').textContent.includes('未更新'),{},{timeout:12000});
 await page.locator('#prompt').fill('EDITED WHILE OFFLINE 下書き');
 await start({ATLAS_SERVICE_PORT:url.port,ATLAS_SERVICE_TOKEN:token});
 await page.waitForFunction(()=>document.querySelector('#service-reconnect').hidden,{},{timeout:40000});
 assert.equal(await page.locator('#prompt').inputValue(),'EDITED WHILE OFFLINE 下書き');
 assert.equal(await page.locator('#new-note').getAttribute('data-identity'),'keep-dom');assert.equal(sends,1);
 // Local file operations still work after a quota rejection and a backend restart.
 const api=async(p,data)=>fetch(url.origin+'/api'+p,{method:data?'POST':'GET',headers:{'x-workspace-token':token,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const prefs=await (await api('/bootstrap')).json();assert.equal(prefs.ui.drafts[task.id],'EDITED WHILE OFFLINE 下書き');
 const folder=await api('/notes/folder',{folder:dir});assert.equal(folder.status,200);
 const note=await api('/notes',{});assert.equal(note.status,200);
 console.log('PASS: quota rejects only AI send; draft preserved; backend restart reconnects without reload or resend; offline edits persist; notes remain usable.');
}finally{await browser?.close();if(child&&!child.killed)child.kill();}
