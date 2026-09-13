// Real UI and events across two windows plus embedded panes, no personal data/AI.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),peer=await context.newPage(),errors=[];
for(const p of [page,peer]){p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));}
try{
 await page.goto(ready.url);await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 const other=new URL(ready.url);other.searchParams.set('window','window-2');await peer.goto(other.href);await peer.locator('#secondary-frame').waitFor();
 await page.locator('#palette-button').click();
 for(const preset of ['nebula','midnight','code','paper','lavender','daylight']){
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/appearance')&&r.status()===200),page.locator('#theme-preset').selectOption(preset)]);
  const mode=['paper','lavender','daylight'].includes(preset)?'light':'dark';
  await peer.locator(`html[data-mode="${mode}"]`).waitFor();
  await peer.frameLocator('#secondary-frame').locator(`html[data-mode="${mode}"]`).waitFor();
  const font=await page.locator('.theme-reading-preview').evaluate(e=>getComputedStyle(e).fontFamily);assert(font.length>5);
 }
 await page.locator('#theme-preset').selectOption('paper');
 await page.locator('#font-preset').selectOption('system');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/appearance')&&r.status()===200),page.locator('#theme-brightness').fill('75')]);
 assert.equal(await page.locator('#theme-preset').inputValue(),'custom');
 await fs.mkdir('.test-data',{recursive:true});await page.screenshot({path:'.test-data/appearance-light.png'});
 await page.reload();await page.locator('html[data-mode="light"]').waitFor();await page.locator('#palette-button').click();
 assert.equal(await page.locator('#font-preset').inputValue(),'system');assert.equal(await page.locator('#theme-brightness').inputValue(),'75');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/appearance')),page.locator('#theme-preset').selectOption('midnight')]);
 await page.screenshot({path:'.test-data/appearance-dark.png'});
 assert.deepEqual(errors,[]);console.log('PASS: six presets, light/dark, font/brightness customization, persistence, two-window and child-pane live sync');
}finally{await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
