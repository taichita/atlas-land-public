import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1),'content-type':'application/json'};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.__hosts=[];window.chrome||={};const callbacks=[];window.chrome.webview={addEventListener(_,fn){callbacks.push(fn);},postMessage(m){window.__hosts.push(m);if(m.requestId)queueMicrotask(()=>callbacks.forEach(fn=>fn({data:{type:'response',requestId:m.requestId,result:true}})));}};});
try {
 await fetch(url.origin+'/api/tabs',{method:'POST',headers,body:JSON.stringify({tabs:Array.from({length:80},(_,i)=>({id:'web-'+i,title:'参考資料 '+String(i).padStart(2,'0'),url:'https://example.org/'+i}))})});
 await page.goto(ready.url);await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 const rail=page.locator('#pane-tabbar');assert.equal((await rail.boundingBox()).width,46);
 await rail.hover();await page.waitForFunction(()=>document.querySelector('#pane-tabbar').dataset.expanded==='true');
 assert.equal(Math.round((await rail.boundingBox()).width),188);
 await page.locator('#tab-search').fill('参考資料 79');assert.equal(await page.locator('#work-tabs [data-tab-key]:visible').count(),1);
 await page.getByRole('button',{name:'参考資料 79',exact:true}).click();await page.locator('#address').waitFor();assert.equal(await page.locator('#address').inputValue(),'https://example.org/79');
 await page.waitForFunction(()=>{const r=document.querySelector('#pane-tabbar').getBoundingClientRect();return __hosts.filter(m=>m.action==='browser.layout').at(-1)?.panes?.some(p=>p.id==='web-79'&&p.x>=r.right);});
 await page.locator('#tab-search').fill('');
 await page.locator('#work-tabs').evaluate(e=>e.scrollTop=0);
 await fs.mkdir('.test-data',{recursive:true});await page.screenshot({path:'.test-data/vertical-tabs-open.png'});
 await page.locator('.brand').hover();await page.waitForFunction(()=>document.querySelector('#pane-tabbar').dataset.expanded==='false');assert.equal((await rail.boundingBox()).width,46);
 await page.waitForFunction(()=>{const r=document.querySelector('#browser-slot').getBoundingClientRect();return __hosts.filter(m=>m.action==='browser.layout').at(-1)?.panes?.some(p=>p.id==='web-79'&&Math.abs(p.x-r.x)<2);});
 await page.screenshot({path:'.test-data/vertical-tabs-closed.png'});
 // Real vertical ordering: drag the last visible tab above the first one.
 await rail.hover();await page.locator('#tab-search').waitFor({state:'visible'});
 await page.locator('#tab-search').fill('参考資料 0');
 const source=page.getByRole('button',{name:'参考資料 02',exact:true}),target=page.getByRole('button',{name:'参考資料 00',exact:true});
 const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+25,a.y+15);await page.mouse.down();await page.mouse.move(b.x+25,b.y+2,{steps:10});await page.mouse.up();
 await page.waitForFunction(()=>[...document.querySelectorAll('#work-tabs [data-tab-key]')].find(e=>e.dataset.tabKey.startsWith('web:'))?.dataset.tabKey==='web:web-2');
 await page.locator('#tab-search').focus();await page.keyboard.press('Escape');assert.equal(await rail.getAttribute('data-expanded'),'false');
 await page.locator('#tab-rail-toggle').focus();await page.keyboard.press('Tab');assert.equal(await rail.getAttribute('data-expanded'),'true');
 assert.deepEqual(errors,[]);console.log('PASS: 80 tabs, hover expansion/collapse, search/select, native browser bounds, vertical reorder, keyboard access');
}finally{await page.mouse.up().catch(()=>{});await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
