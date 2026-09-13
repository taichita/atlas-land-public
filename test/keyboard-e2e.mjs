// Keyboard regression checks in a disposable profile; no user data or AI calls.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line)));child.once('error',reject);});
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
try {
  await page.goto(ready.url);
  await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
  await page.keyboard.press('F1');
  await page.locator('.shortcut-editor').waitFor();
  await page.locator('#shortcut-search').fill('再生速度');
  assert.equal(await page.locator('[data-shortcut-row]:visible').count(),2);
  await page.locator('#shortcut-search').fill('');
  await page.locator('[data-shortcut-command="new-tab"]').click();
  await page.keyboard.press('Control+Alt+T');
  assert.match(await page.locator('[data-shortcut-command="new-tab"]').innerText(),/Ctrl.*Alt.*T/);
  await page.waitForResponse(r=>r.url().endsWith('/api/preferences')&&r.request().method()==='POST');
  await page.reload();
  await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
  const tabs=page.locator('#work-tabs button[data-view]'),before=await tabs.count();
  await page.keyboard.press('Control+Alt+T');
  await page.waitForFunction(n=>document.querySelectorAll('#work-tabs button[data-view]').length===n,before+1);
  await page.keyboard.press('Control+W');
  await page.waitForFunction(n=>document.querySelectorAll('#work-tabs button[data-view]').length===n,before);
  await page.keyboard.press('Control+Shift+T');
  await page.waitForFunction(n=>document.querySelectorAll('#work-tabs button[data-view]').length===n,before+1);
  await page.keyboard.press('Control+1');
  await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
  await page.keyboard.press('Control+Backslash');
  await page.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===2);
  await page.frameLocator('.pane-frame').nth(1).locator('#editor-name').waitFor();
  await page.keyboard.press('Control+Shift+W');
  await page.waitForFunction(()=>document.querySelectorAll('.pane-frame').length===1);
  await page.keyboard.press('F1');
  await page.locator('#shortcut-reset-all').click();
  assert.match(await page.locator('[data-shortcut-command="new-tab"]').innerText(),/Ctrl.*T/);
  await page.screenshot({path:'.test-data/keyboard-shortcuts.png'});
  assert.deepEqual(errors,[]);
  console.log('Keyboard UI passed: search, remap, persistence, new/close/reopen tab, numbered tab, pane split and reset.');
} finally {
  await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();
}
