import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const base=new URL(ready.url),headers={'x-workspace-token':base.hash.slice(1)};
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),peer=await context.newPage(),errors=[];
for(const p of [page,peer]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));}
try{
 await page.goto(ready.url);await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 const other=new URL(ready.url);other.searchParams.set('window','window-2');await peer.goto(other.href);
 await page.locator('#open-web-home').click();await page.locator('#address').fill('https://example.org/research');await page.locator('#address').press('Enter');
 await page.locator('#bookmark-page').click();await page.locator('#bookmark-page').filter({hasText:'★'}).waitFor();
 await peer.locator('#app-menu summary').click();await peer.locator('#menu-bookmarks').click();await peer.locator('.bookmark-row').waitFor();
 assert.equal(await peer.locator('.bookmark-row').count(),1);
 await peer.locator('[data-bookmark-edit]').click();await peer.locator('#bookmark-title').fill('調査の参考資料');await peer.locator('#bookmark-save').click();await peer.locator('.bookmark-row').filter({hasText:'調査の参考資料'}).waitFor();
 await peer.locator('#bookmark-search').fill('存在しない');assert.equal(await peer.locator('.bookmark-row').count(),0);await peer.locator('#bookmark-search').fill('参考資料');
 await peer.locator('[data-bookmark-open]').click();await peer.locator('#address').waitFor();assert.equal(await peer.locator('#address').inputValue(),'https://example.org/research');
 await page.reload();await page.locator('#bookmark-page').filter({hasText:'★'}).waitFor();await page.locator('#show-bookmarks').click();
 assert.match(await page.locator('#bookmark-results').textContent(),/調査の参考資料/);
 const saved=JSON.parse(await fs.readFile(path.join(ready.data,'workspace.json'),'utf8'));assert.equal(saved.bookmarks.length,1);
 await page.screenshot({path:'.test-data/bookmarks.png'});
 await page.locator('[data-bookmark-edit]').click();await page.locator('#bookmark-remove').click();await page.locator('#bookmark-results .empty').waitFor();
 await peer.locator('#bookmark-page').filter({hasText:'☆'}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS: star/save, shared list, rename/search/open, persistence, delete and cross-window star update');
}finally{await browser.close();await fetch(base.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
