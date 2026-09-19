// Synthetic tasks and microphone only; never contacts an AI or user's microphone.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line))));
const base=new URL(ready.url),headers={'x-workspace-token':base.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
const tasks=[{id:'one',title:'自分の案件',cwd:ready.data,state:'completed',hasConversation:true,edits:[],events:[]},{id:'two',title:'次の案件',cwd:ready.data,state:'disconnected',hasConversation:true,unread:true,lastReplyAt:Date.now(),edits:[],events:[]}];
let lastCwd,reconnects=0,transcriptions=0;
await page.addInitScript(folder=>{
 window.__hosts=[];window.__nativeHandlers=[];window.chrome||={};window.chrome.webview={addEventListener(_,fn){__nativeHandlers.push(fn);},postMessage(m){__hosts.push(m);if(m.requestId)queueMicrotask(()=>__nativeHandlers.forEach(fn=>fn({data:{type:'response',requestId:m.requestId,result:m.action==='chooseFolder'?folder:true}})));}};
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[{stop(){}}]})});
 window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic'])});this.onstop?.();}};
},ready.data);
await page.route('**/api/bootstrap',async route=>{const response=await route.fetch(),b=await response.json();b.tasks=tasks;b.tabs=[];b.ui={...b.ui,active:'one',open:['one'],viewTabs:[],rightPane:null,paneWorkspace:{panes:[]},activeView:null};await route.fulfill({response,json:b});});
await page.route('**/api/tasks',async route=>{lastCwd=route.request().postDataJSON().cwd;const t={...tasks[0],id:'new',title:'新しい案件',hasConversation:false,state:'idle'};tasks.push(t);await route.fulfill({json:t});});
await page.route('**/api/tasks/*/**',async route=>{
 const parts=new URL(route.request().url()).pathname.split('/'),t=tasks.find(t=>t.id===parts[3]),op=parts[4];
 if(op==='history')return route.fulfill({json:{data:[{id:'turn',status:'completed',items:[{id:'answer',type:'agentMessage',text:'Fixture reply'}]}]}});
 if(op==='settings')Object.assign(t,route.request().postDataJSON());if(op==='seen')t.unread=false;
 if(op==='reconnect'){reconnects++;t.state='completed';}
 await route.fulfill({json:op==='files'?{files:[]}:t});
});
await page.route('**/api/connections',route=>route.fulfill({json:{voice:[{id:'groq',configured:true}]}}));
await page.route('**/api/voice/transcribe?*',route=>{transcriptions++;return route.fulfill({json:{text:'音声から入力した下書き'}});});
const native=message=>page.evaluate(m=>__nativeHandlers.forEach(fn=>fn({data:m})),message);
try{
 await page.goto(ready.url);await page.locator('#conversation .message').waitFor();
 assert.match(await page.locator('.brand').innerText(),/Atlas Browser/);assert.match(await page.locator('.brand>span').evaluate(e=>getComputedStyle(e).fontFamily),/Georgia/);
 assert.equal(await page.locator('.work-tab .provider-openai').count(),1);
 await page.locator('#default-folder').click();await page.waitForFunction(folder=>document.querySelector('#default-folder').title.includes(folder),ready.data);
 await native({type:'shortcut',command:'sidebar'});await page.locator('#sidebar-notification').waitFor();await page.locator('#sidebar-notification').click();
 await page.locator('#reconnect-task').waitFor();await page.locator('#reconnect-task').click();await page.locator('#reconnect-task').waitFor({state:'hidden'});assert.equal(reconnects,1);
 await native({type:'shortcut',command:'sidebar'});await page.locator('button[data-task="two"]').hover();await page.locator('[data-dismiss="two"]').click();await page.locator('button[data-task="two"]').waitFor({state:'hidden'});assert(tasks[1].stored);
 await page.locator('button[data-task="one"]').click();await page.locator('#composer-toggle').click();await page.locator('#prompt').fill('書きかけ');
 await page.locator('#voice-input').click();await page.locator('#voice-input.recording').waitFor();await page.locator('#voice-cancel').click();assert.equal(transcriptions,0);
 await page.locator('#voice-input').click();await page.locator('#voice-input.recording').waitFor();await page.waitForTimeout(450);await page.locator('#voice-input').click();
 await page.waitForFunction(()=>document.querySelector('#prompt').value.includes('音声から入力した下書き'));assert.equal(transcriptions,1);assert.match(await page.locator('#prompt').inputValue(),/^書きかけ/);
 await page.locator('#new-task').click();await page.locator('#task-title').filter({hasText:'新しい案件'}).waitFor();assert.equal(lastCwd,ready.data);assert.equal(await page.locator('button[data-task="new"]').count(),0);
 await page.screenshot({path:'.test-data/personalization.png'});
 await native({type:'app.closing'});await page.waitForFunction(()=>__hosts.some(m=>m.action==='app.exit'));
 await page.waitForTimeout(650); // Delayed preference saves cannot undo the close reset.
 const b=await(await fetch(base.origin+'/api/bootstrap',{headers})).json();assert.deepEqual(b.ui.viewTabs,[]);assert.deepEqual(b.ui.paneWorkspace.panes,[]);assert.match(b.ui.drafts.one.text||b.ui.drafts.one,/音声から入力した下書き/);
 assert.deepEqual(errors,[]);console.log('PASS: Georgia branding, provider icon, persistent default folder, hide/notification/dismiss, reconnect, synthetic voice draft, clean close preserves drafts');
}finally{await browser.close();await fetch(base.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
