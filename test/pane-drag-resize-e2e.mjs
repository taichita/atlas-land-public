import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',s=>resolve(JSON.parse(s)));child.once('error',reject);});
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1450,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
async function dragTab(source,target){
  await source.scrollIntoViewIfNeeded();
  const a=await source.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+25,a.y+a.height/2+20,{steps:8});
  await page.locator('.pane-drop-layer').waitFor();
  const b=await page.locator(target).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+65,{steps:15});await page.mouse.up();
  await page.locator('.pane-drop-layer').waitFor({state:'detached'});
}
try{
  await page.goto(ready.url);const right=page.frameLocator('#secondary-frame');
  await right.locator('#editor-name').filter({hasText:'preview.html'}).waitFor();
  await page.locator('#pane-layout').selectOption('rows');
  const before=await page.locator('#primary-slot').boundingBox(),bar=await page.locator('.pane-resizer[data-axis="rows"]').boundingBox();
  await page.mouse.move(bar.x+bar.width/2,bar.y+4);await page.mouse.down();await page.mouse.move(bar.x+bar.width/2,bar.y+120,{steps:10});await page.mouse.up();
  const after=await page.locator('#primary-slot').boundingBox();assert(after.height>before.height+90);
  await page.waitForResponse(r=>r.url().endsWith('/api/preferences')&&r.request().method()==='POST');
  await page.reload();await right.locator('#editor-name').waitFor();
  assert(Math.abs((await page.locator('#primary-slot').boundingBox()).height-after.height)<3);
  await page.locator('#pane-layout').selectOption('columns');
  const leftTab=page.locator('[data-tab-key]').filter({hasText:'review.md'});
  await dragTab(leftTab,'.pane-drop-zone:not([data-drop-pane="primary"])');
  await right.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
  assert.equal(await page.locator('[data-tab-key]').filter({hasText:'review.md'}).count(),0);
  await right.locator('#edit-mode').click();await right.locator('#text-editor').fill('Unsaved draft survives moving');
  await dragTab(right.locator('[data-tab-key]').filter({hasText:'review.md'}),'.pane-drop-zone[data-drop-pane="primary"]');
  await page.locator('#text-editor').waitFor();assert.equal(await page.locator('#text-editor').inputValue(),'Unsaved draft survives moving');
  assert.equal(await right.locator('[data-tab-key]').filter({hasText:'review.md'}).count(),0);
  // Adding many tabs must never hide the buttons outside the tab scroller.
  for(let i=0;i<12;i++)await right.locator('#open-web-home').click();
  const add=await right.locator('#open-web-home').boundingBox(),frame=await page.locator('#secondary-frame').boundingBox();
  assert(add.x>=frame.x&&add.x+add.width<=frame.x+frame.width);
  await dragTab(right.locator('[data-tab-key]').last(),'.pane-drop-zone[data-drop-pane="primary"]');
  await page.locator('#address').waitFor();assert.equal(await right.locator('[data-tab-key]').count(),12);
  await page.locator('#pane-split').click();await page.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===2);
  await page.locator('#pane-layout').selectOption('auto');
  await page.locator('.pane-resizer[data-axis="rows"]').focus();await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.pane-resizer[data-axis="columns"]').count(),1);
  assert.equal(await page.locator('.pane-resizer[data-axis="rows"]').count(),1);
  // Reordering in one pane uses the same drag operation.
  await page.locator('#work-tabs').evaluate(e=>e.scrollLeft=0);
  const firstKey=await page.locator('[data-tab-key]').first().getAttribute('data-tab-key');
  await dragTab(page.locator('[data-tab-key]').first(),'.pane-drop-zone[data-drop-pane="primary"]');
  await page.waitForFunction(key=>document.querySelector('#work-tabs [data-tab-key]:last-of-type')?.dataset.tabKey===key,firstKey);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'.test-data/pane-drag-resize.png'});
  console.log('Pane drag/resize passed: real cross-frame drag both directions, unsaved draft, tab reorder, persistent vertical resizing, grid handles and always-visible add buttons.');
}catch(error){console.error(error);throw error;}finally{await page.mouse.up().catch(()=>{});await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
