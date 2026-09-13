// Disposable workspace, real UI and mocked native transport. No AI submissions.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',s=>resolve(JSON.parse(s)));child.once('error',reject);});
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
  await page.goto(ready.url);
  const right=page.frameLocator('#secondary-frame');
  await right.locator('#editor-name').filter({hasText:'preview.html'}).waitFor();
  assert.equal(await right.locator('#work-tabs button[data-view]').count(),1);
  const leftCount=await page.locator('#work-tabs button[data-view]').count();
  await right.locator('#open-web-home').click();await right.locator('#address').waitFor();
  await right.locator('#open-web-home').click();
  assert.equal(await right.locator('#work-tabs button[data-view]').count(),3);
  assert.equal(await page.locator('#work-tabs button[data-view]').count(),leftCount);
  await right.locator('#address').focus();await page.keyboard.press('Control+T');
  await right.locator('#work-tabs button[data-view]').nth(3).waitFor();
  await page.keyboard.press('Control+W');
  await page.waitForFunction(()=>document.querySelector('#secondary-frame').contentDocument.querySelectorAll('#work-tabs button[data-view]').length===3);
  await page.keyboard.press('Control+Shift+T');
  await right.locator('#work-tabs button[data-view]').nth(3).waitFor();
  await page.keyboard.press('Control+1');
  await right.locator('#editor-name').filter({hasText:'preview.html'}).waitFor();
  for(let count=3;count<=6;count++){
    await page.locator('#pane-split').click();
    await page.waitForFunction(n=>document.querySelectorAll('.pane-frame').length===n,count-1);
    const newest=page.frameLocator('.pane-frame').nth(count-2);
    await newest.locator('#editor-name').filter({hasText:'preview.html'}).waitFor();
  }
  const rects=await page.locator('#primary-slot,.extra-pane').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  assert.equal(rects.length,6);assert(rects.every(r=>r.w>300&&r.h>300));
  for(let a=0;a<rects.length;a++)for(let b=a+1;b<rects.length;b++){
    const x=rects[a],y=rects[b];assert(x.x+x.w<=y.x+1||y.x+y.w<=x.x+1||x.y+x.h<=y.y+1||y.y+y.h<=x.y+1,'panes overlap');
  }
  await page.locator('#pane-layout').selectOption('rows');
  assert.equal(await page.locator('#workspace-deck').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
  await page.locator('#pane-layout').selectOption('auto');
  await right.locator('#work-tabs button[data-view]').nth(1).click();
  await right.locator('[data-pane-action="move-pane"]').click();
  const third=page.frameLocator('.pane-frame').nth(1);
  await third.locator('#address').waitFor();
  assert.equal(await third.locator('#work-tabs button[data-view]').count(),2);
  await page.waitForResponse(r=>r.url().endsWith('/api/preferences')&&r.request().method()==='POST');
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===5);
  await page.frameLocator('.pane-frame').nth(4).locator('#editor-name').waitFor();
  assert.equal(await right.locator('#work-tabs button[data-view]').count(),3);
  assert.equal(await third.locator('#work-tabs button[data-view]').count(),2);
  await third.locator('#address').focus();await page.keyboard.press('Control+Shift+W');
  await page.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===4);
  await page.screenshot({path:'.test-data/multiple-panes.png'});
  const nativePage=await browser.newPage({viewport:{width:1600,height:1100}});
  nativePage.on('pageerror',e=>errors.push(e.message));
  await nativePage.addInitScript(()=>{
    if(window.parent!==window)return;
    window.__host=[];window.__callbacks=[];window.chrome||={};window.chrome.webview={
      postMessage(m){window.__host.push(m);if(m.requestId)queueMicrotask(()=>window.__callbacks.forEach(cb=>cb({data:{type:'response',requestId:m.requestId,result:true}})));},
      addEventListener(_,cb){window.__callbacks.push(cb);}
    };
  });
  await nativePage.goto(ready.url);
  await nativePage.frameLocator('#secondary-frame').locator('#work-tabs').waitFor();
  const nr=nativePage.frameLocator('#secondary-frame');
  await nr.locator('#open-web-home').click();
  await nativePage.waitForFunction(()=>window.__host.some(m=>m.action==='browser.open'&&m.id.startsWith('pane-')));
  const webId=await nativePage.evaluate(()=>window.__host.filter(m=>m.action==='browser.open'&&m.id.startsWith('pane-')).at(-1).id);
  const before=await nr.locator('#work-tabs button[data-view]').count();
  await nativePage.evaluate(id=>window.__callbacks.forEach(cb=>cb({data:{type:'shortcut',command:'new-tab',id}})),webId);
  await nr.locator('#work-tabs button[data-view]').nth(before).waitFor();
  const primaryTabs=await nativePage.locator('#work-tabs button[data-view]').count();
  await nativePage.evaluate(id=>window.__callbacks.forEach(cb=>cb({data:{type:'browser.created',id:id.slice(0,id.indexOf(':')+1)+'popup-test',url:'https://example.org',title:'Popup'}})),webId);
  await nr.locator('#work-tabs button[data-view]').filter({hasText:'Popup'}).waitFor();
  assert.equal(await nativePage.locator('#work-tabs button[data-view]').count(),primaryTabs);
  await nativePage.waitForFunction(()=>window.__host.some(m=>m.action==='browser.layout'&&m.panes?.some(p=>p.id.startsWith('pane-')&&p.width>0&&p.x>0)));
  await nativePage.locator('#work-tabs button[data-view]').first().click();
  const countBeforeClose=await nativePage.locator('.pane-frame').count();
  await nativePage.locator('#pane-close').click();
  await nativePage.waitForFunction(n=>document.querySelectorAll('.pane-frame').length===n,countBeforeClose-1);
  await nativePage.locator('#work-tabs button[data-view]').filter({hasText:'Popup'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('Multiple panes passed: six panes, isolated tabs, local shortcuts, transfer, grid, persistence, close and native routing.');
}finally{await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
