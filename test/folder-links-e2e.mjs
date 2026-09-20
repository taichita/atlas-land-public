import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line))));
const binary=path.join(ready.data,'setup.exe'),file=await fs.open(binary,'w');await file.truncate(54*1024*1024);await file.close();
await fs.writeFile(ready.note,'# 配布\n\n[親フォルダ](<'+ready.data.replaceAll('\\','/')+'>)\n\n[セットアップ](<'+binary.replaceAll('\\','/')+'>)');
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();page.setDefaultTimeout(10000);
await page.addInitScript(()=>{window.__hosts=[];window.__handlers=[];window.chrome||={};window.chrome.webview={addEventListener(_,fn){__handlers.push(fn);},postMessage(m){__hosts.push(m);if(m.requestId)queueMicrotask(()=>__handlers.forEach(fn=>fn({data:{type:'response',requestId:m.requestId,result:true}})));}};});
try{
 await page.goto(ready.url);await page.getByRole('link',{name:'親フォルダ',exact:true}).click();
 await page.waitForFunction(()=>__hosts.filter(m=>m.action==='file.reveal').length===1);
 await page.getByRole('link',{name:'セットアップ',exact:true}).click();
 await page.waitForFunction(()=>__hosts.filter(m=>m.action==='file.reveal').length===2);
 assert.deepEqual(await page.evaluate(()=>__hosts.filter(m=>m.action==='file.reveal').map(m=>m.path)),[ready.data,ready.data]);
 await page.route('**/api/local/open',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'ファイルを選んでください'})}));
 await page.getByRole('link',{name:'親フォルダ',exact:true}).click();await page.waitForFunction(()=>__hosts.filter(m=>m.action==='file.reveal').length===3);
 assert.equal((await page.evaluate(()=>__hosts.filter(m=>m.action==='file.reveal').at(-1).path)).replaceAll('\\','/'),ready.data.replaceAll('\\','/'));
 console.log('PASS: folder and 54MB executable links reveal the containing folder without opening an editor or executing the binary.');
}catch(e){console.log(await page.locator('body').innerText());throw e;}finally{await browser.close();const url=new URL(ready.url);await fetch(url.origin+'/api/shutdown',{method:'POST',headers:{'x-workspace-token':url.hash.slice(1)}}).catch(()=>{});child.kill();}
