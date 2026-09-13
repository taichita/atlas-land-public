import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
await page.addInitScript(folder=>{window.__hosts=[];const handlers=[];window.chrome||={};window.chrome.webview={addEventListener(_,fn){handlers.push(fn);},postMessage(m){window.__hosts.push(m.action);if(m.requestId)queueMicrotask(()=>handlers.forEach(fn=>fn({data:{type:'response',requestId:m.requestId,result:m.action==='chooseFolder'?folder:true}})));}};},ready.data);
try{
 await page.goto(ready.url);await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 await page.locator('#new-note').click();await page.locator('#text-editor').waitFor();
 assert.equal(await page.locator('#text-editor').evaluate(e=>e===document.activeElement),true);
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/local/draft')&&r.request().postDataJSON()?.text==='まず思いついたことを書く。'),page.locator('#text-editor').fill('まず思いついたことを書く。')]);
 assert.equal(await page.evaluate(()=>__hosts.filter(x=>x==='chooseFolder').length),1);
 await page.reload();await page.locator('#text-editor').waitFor();assert.equal(await page.locator('#text-editor').inputValue(),'まず思いついたことを書く。');
 await page.locator('#save-file').click();await page.locator('#note-name').fill('自分のメモ.txt');
 await page.locator('#note-save-cancel').click();assert.equal(await page.locator('#text-editor').inputValue(),'まず思いついたことを書く。');
 await fs.writeFile(path.join(ready.data,'既存.txt'),'もとの内容');
 await page.locator('#save-file').click();await page.locator('#note-name').fill('既存.txt');await page.locator('#note-save-confirm').click();await page.locator('#note-save-error').filter({hasText:'同名'}).waitFor();
 await page.locator('#note-name').fill('自分のメモ.txt');await page.locator('#note-save-confirm').click();await page.locator('#dialog').waitFor({state:'hidden'});
 assert.equal(await fs.readFile(path.join(ready.data,'自分のメモ.txt'),'utf8'),'まず思いついたことを書く。');
 await page.locator('#new-note').click();await page.locator('#text-editor').waitFor();assert.equal(await page.evaluate(()=>__hosts.filter(x=>x==='chooseFolder').length),0);
 await page.locator('#save-file').click();await page.screenshot({path:'.test-data/note-save.png'});
 assert.deepEqual(errors,[]);console.log('PASS: folder chosen once, instant focused note, autosaved draft restored, save confirmation/cancel, no overwrite, remembered folder');
}finally{await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
