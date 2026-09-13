// Disposable UI, mocked conversation: no model calls or personal sessions.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line))));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:800,height:500}});
page.setDefaultTimeout(8000);
const task={id:'composer-test',title:'入力欄の確認',cwd:'C:\\dev',state:'completed',hasConversation:true,edits:[],images:[],artifacts:[]};
try {
 await page.route('**/api/tasks',r=>r.request().method()==='POST'?r.fulfill({json:task}):r.continue());
 await page.route('**/api/tasks/composer-test/**',r=>r.fulfill({json:r.request().url().endsWith('/files')?{files:[]}:{turns:[]}}));
 await page.goto(ready.url);
 await page.locator('#new-task').click();
 await page.locator('#composer-toggle').waitFor();
 assert.equal(await page.locator('#prompt').isVisible(),false);
 assert((await page.locator('#composer').boundingBox()).height<55);
 await page.locator('#composer-toggle').click();
 await page.locator('#prompt').fill('残しておく下書き');
 await page.locator('#composer-toggle').click();
 assert.equal(await page.locator('#prompt').isVisible(),false);
 await page.locator('#composer-toggle').click();
 assert.equal(await page.locator('#prompt').inputValue(),'残しておく下書き');
 assert.equal(await page.locator('#prompt').evaluate(e=>e===document.activeElement),true);
 await page.locator('#send').click();
 await page.waitForFunction(()=>document.querySelector('#composer-fields').hidden);
 assert.equal(await page.locator('#prompt').inputValue(),'');
 console.log('PASS: compact composer, expand/focus, preserved draft, collapse after send');
} finally {await browser.close();await fetch(new URL('/api/shutdown',ready.url),{method:'POST',headers:{'x-workspace-token':new URL(ready.url).hash.slice(1)}}).catch(()=>{});child.kill();}
