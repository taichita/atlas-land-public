// Only synthetic conversation data. No live user sessions or model calls.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const child = spawn(process.execPath, ['test/ui-session.mjs'], {windowsHide:true, stdio:['ignore','pipe','pipe']});
child.stderr.on('data', () => {});
const ready = await new Promise((resolve,reject) => {
  createInterface({input:child.stdout}).once('line', l => resolve(JSON.parse(l)));
  child.once('error',reject);
});
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const page = await browser.newPage();
  const turns = Array.from({length:16}, (_,n) => ({id:`turn-${n+1}`,status:'completed',startedAt:n+1,items:[
    {id:`u-${n+1}`,type:'userMessage',content:[{type:'text',text:`Question ${n+1}`}]},
    {id:`a-${n+1}`,type:'agentMessage',text:`Answer ${n+1}`},
  ]}));
  const task = {id:'history-fixture',title:'History fixture',cwd:ready.data,hasConversation:true,state:'completed',activeTurn:null,edits:[],artifacts:[],events:[]};
  await page.route('**/api/bootstrap',async route => {
    const response = await route.fetch();
    const b = await response.json();
    b.tasks=[task,{...task,id:'history-second',title:'Second chat'}]; b.tabs=[]; b.links=[]; b.ui={appearanceVersion:3,active:task.id,open:[task.id],viewTabs:[],drafts:{}};
    await route.fulfill({response,json:b});
  });
  await page.route('**/api/tasks/history-*/**',async route => {
    const u = new URL(route.request().url());
    if(u.pathname.endsWith('/history')) {
      const older=u.searchParams.has('cursor');
      return route.fulfill({json:{data:(older?turns.slice(0,4):turns.slice(4)).slice().reverse(),nextCursor:older?null:'older',
        live:turns.flatMap(t=>t.items)}});
    }
    await route.fulfill({json:u.pathname.endsWith('/seen')?task:{files:[],data:[]}});
  });
  await page.goto(ready.url);
  await page.locator('#conversation .message').first().waitFor();
  assert.equal(await page.locator('#conversation .message').count(),24);
  assert.equal(await page.locator('#conversation .message').first().innerText(),'\u3042\u306a\u305f\nQuestion 5');
  assert.match(await page.locator('#conversation .message').last().innerText(),/Answer 16$/);
  const atBottom=()=>page.locator('#conversation').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<5);
  assert(await atBottom(),'initial history opens at newest reply');
  await page.locator('#conversation').evaluate(el=>el.scrollTop=0);
  await page.locator('[data-task="history-second"]').click();await page.waitForFunction(()=>document.querySelector('#conversation').dataset.task==='history-second');
  assert(await atBottom(),'switch to another chat starts at its newest reply');
  await page.locator('[data-task="history-fixture"]').click();assert(await atBottom(),'switching back also opens newest reply');
  await page.locator('#load-older').click();
  await page.waitForFunction(()=>document.querySelectorAll('#conversation .message').length===32);
  assert.match(await page.locator('#conversation .message').first().innerText(),/Question 1$/);
  assert.match(await page.locator('#conversation .message').last().innerText(),/Answer 16$/);
  await page.reload();
  await page.locator('#conversation .message').first().waitFor();
  assert.equal(await page.locator('#conversation .message').count(),24);
  const prompt='日本語のプロンプト\n<literal> & "quotes"\n改行も保持';
  turns.at(-1).items[1].text='説明文\n\n```text\n'+prompt+'\n```\n\n補足';
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(ready.url).origin});
  await page.reload();await page.locator('[data-copy-code]').waitFor();
  await page.locator('[data-copy-code]').click();
  assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n'),prompt+'\n');
  await page.locator('[data-copy-message="a-16"]').click();
  assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replaceAll('\r\n','\n'),turns.at(-1).items[1].text);
  console.log('History UI: no replay, chronology and reload; prompt-only and full-answer clipboard contents passed.');
} finally {
  await browser.close(); child.kill();
}
