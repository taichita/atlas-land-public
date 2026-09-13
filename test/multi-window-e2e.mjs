// Two independent top-level windows, real server persistence, no AI calls.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const base=new URL(ready.url),headers={'x-workspace-token':base.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const a=await context.newPage(),b=await context.newPage(),errors=[];
await b.addInitScript(()=>{window.__nativeHandlers=[];window.chrome||={};window.chrome.webview={addEventListener(_,fn){window.__nativeHandlers.push(fn);},postMessage(m){if(m.requestId)queueMicrotask(()=>window.__nativeHandlers.forEach(fn=>fn({data:{type:'response',requestId:m.requestId,result:true}})));}};});
for(const p of [a,b]){p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));}
const read=async id=>(await fetch(base.origin+'/api/bootstrap',{headers:{...headers,'x-atlas-window':id}})).json();
const goto=async(p,id)=>{const url=new URL(ready.url);url.searchParams.set('window',id);await p.goto(url.href);};
try{
 await goto(a,'main');await a.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 await goto(b,'window-2');await b.locator('#secondary-frame').waitFor();
 assert.equal(await b.locator('#work-tabs button[data-view]').count(),0);
 await b.locator('#open-web-home').click();
 await b.locator('#address').fill('https://example.org/second-window');
 // Distinct draft/preferences writes cannot erase the other window's records.
 for(const id of ['main','window-2']){const data=await read(id);await fetch(base.origin+'/api/preferences',{method:'POST',headers:{...headers,'x-atlas-window':id,'content-type':'application/json'},body:JSON.stringify({...data.ui,drafts:{note:id}})});}
 assert.equal((await read('main')).ui.drafts.note,'main');assert.equal((await read('window-2')).ui.drafts.note,'window-2');
 await a.reload();await a.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 await b.reload();await b.locator('#address').waitFor();
 assert.equal(await b.locator('#work-tabs button[data-view]').count(),1);
 assert.equal(await a.locator('#work-tabs button[data-view]').count(),3);
 // Closing the first UI doesn't stop the shared server or second window.
 await a.close();assert((await read('window-2')).ui);
 const secondary=b.frameLocator('#secondary-frame');await secondary.locator('#open-web-home').click();await secondary.locator('#address').waitFor();
 await b.locator('#pane-split').click();await b.locator('.pane-frame').nth(1).waitFor();
 for(let i=0;i<60&&(await read('window-2')).ui.paneWorkspace.panes.length!==2;i++)await new Promise(r=>setTimeout(r,100));
 assert.equal((await read('window-2')).ui.paneWorkspace.panes.length,2);
 await b.reload();await b.locator('.pane-frame').nth(1).waitFor();
 assert.equal((await read('main')).ui.paneWorkspace.panes.length,1);
 assert.equal(new URL(b.url()).searchParams.get('window'),'window-2');
 await b.locator('#pane-split').click();await b.locator('.pane-frame').nth(2).waitFor();
 const before=await b.evaluate(()=>[...new Set([document,...[...document.querySelectorAll('.pane-frame')].map(f=>f.contentDocument)].flatMap(d=>[...d.querySelectorAll('#work-tabs [data-view]')].map(e=>e.dataset.view)))]);
 await b.evaluate(()=>window.__nativeHandlers.forEach(fn=>fn({data:{type:'window.twoPanes'}})));
 await b.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===1);
 const after=await b.evaluate(()=>[...new Set([document,...[...document.querySelectorAll('.pane-frame')].map(f=>f.contentDocument)].flatMap(d=>[...d.querySelectorAll('#work-tabs [data-view]')].map(e=>e.dataset.view)))]);
 assert.deepEqual(after.sort(),before.sort());
 assert.deepEqual(errors,[]);console.log('PASS: two windows, independent tabs/drafts/layout, reload, shared server survives first UI close');
}catch(e){console.log(JSON.stringify({url:b.url(),errors,toast:await b.locator('#toast').textContent(),frames:await b.locator('.pane-frame').count(),saved:(await read('window-2')).ui.paneWorkspace}));throw e;}finally{await browser.close();await fetch(base.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
