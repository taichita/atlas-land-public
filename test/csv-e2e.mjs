import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try {
 const csv=path.join(ready.data,'台本.csv');
 const original=process.argv[2]?await fs.readFile(process.argv[2],'utf8'):'\uFEFF# === 第一章 ===\r\n\r\n魔理沙,最初のセリフ\r\n霊夢,次のセリフ\r\n';
 await fs.writeFile(csv,original);
 await fs.writeFile(ready.note,`[台本を開く](<${csv.replaceAll('\\','/')}>)`);
 await page.goto(ready.url);await page.getByRole('link',{name:'台本を開く',exact:true}).click();
 await page.locator('.csv-row').first().waitFor();assert.equal(await page.locator('.csv-error').count(),0);
 await page.locator('#source-mode').click();assert.equal(await page.locator('#text-editor').inputValue(),original.replace(/^\uFEFF/,'').replaceAll('\r\n','\n'));
 assert.equal(await fs.readFile(csv,'utf8'),original);
 await fs.writeFile(csv,'話者,本文\r\n魔理沙,"閉じていない引用符');
 await page.reload();await page.locator('#read-mode').click();await page.locator('.csv-error').waitFor();
 await page.locator('#source-mode').click();assert.match(await page.locator('#text-editor').inputValue(),/閉じていない引用符/);
 assert.deepEqual(errors,[]);console.log('PASS: chapter/blank rows render, source remains intact, malformed quotes still reported');
}finally{await browser.close();await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
