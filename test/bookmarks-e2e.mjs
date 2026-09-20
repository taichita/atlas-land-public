import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
const child=spawn(process.execPath,['test/ui-session.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise(resolve=>createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l))));
const base=new URL(ready.url),headers={'x-workspace-token':base.hash.slice(1),'content-type':'application/json'};
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),peer=await context.newPage(),errors=[];
for(const p of [page,peer]){p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));}
const post=async body=>(await fetch(base.origin+'/api/bookmarks',{method:'POST',headers,body:JSON.stringify(body)})).json();
try{
 await post({kind:'folder',title:'Chrome Profile 1'});
 let items=await (await fetch(base.origin+'/api/bookmarks',{headers})).json();
 await post({kind:'folder',title:'Deep folder',parentId:items[0].id});
 items=await (await fetch(base.origin+'/api/bookmarks',{headers})).json();
 await post({title:'Deep reference',url:'https://example.net/',parentId:items[0].id});
 await page.goto(ready.url);await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 const other=new URL(ready.url);other.searchParams.set('window','window-2');await peer.goto(other.href);
 await page.locator('#rail-bookmarks').hover();await page.locator('[data-quick-bookmark]').filter({hasText:'Deep reference'}).waitFor();
 assert.equal(await page.locator('[data-quick-bookmark]').count(),1);
 assert(!await page.locator('#bookmark-flyout').textContent().then(t=>t.includes('Profile')));
 await page.keyboard.press('Escape');
 await page.locator('#open-web-home').click();await page.locator('#address').fill('https://example.org/research');await page.locator('#address').press('Enter');
 await page.locator('#bookmark-page').hover();await page.locator('[data-save-mark="heart"]').click();await page.locator('#bookmark-page').filter({hasText:'♥'}).waitFor();
 await peer.locator('[data-bookmark-mark="heart"]').hover();await peer.locator('[data-quick-bookmark]').waitFor();
 assert.equal(await peer.locator('[data-quick-bookmark]').count(),1);
 await peer.locator('.bookmark-manage').click();await peer.locator('[data-bookmark-edit]').click();
 await peer.locator('#bookmark-title').fill('調査の参考資料');await peer.locator('#bookmark-mark').selectOption('diamond');await peer.locator('#bookmark-save').click();
 await peer.locator('[data-bookmark-filter="diamond"]').click();await peer.locator('.bookmark-row').filter({hasText:'調査の参考資料'}).waitFor();
 await page.locator('#bookmark-page').filter({hasText:'◆'}).waitFor();
 await peer.locator('#bookmark-search').fill('存在しない');assert.equal(await peer.locator('.bookmark-row').count(),0);await peer.locator('#bookmark-search').fill('参考資料');
 await peer.locator('[data-bookmark-open]').click();await peer.locator('#address').waitFor();assert.equal(await peer.locator('#address').inputValue(),'https://example.org/research');
 await page.reload();await page.locator('#bookmark-page').filter({hasText:'◆'}).waitFor();
 await page.locator('[data-bookmark-mark="diamond"]').hover();await page.locator('[data-quick-bookmark]').filter({hasText:'調査の参考資料'}).click();
 assert.equal(await page.locator('#address').inputValue(),'https://example.org/research');
 await page.locator('[data-bookmark-mark="diamond"]').hover();await page.locator('.bookmark-manage').click();
 await page.locator('[data-bookmark-edit]').click();await page.locator('#bookmark-remove').click();await page.locator('#bookmark-results .empty').waitFor();
 await peer.locator('#bookmark-page').filter({hasText:'☆'}).waitFor();assert.deepEqual(errors,[]);
 // Real sync endpoint against disposable Chrome profiles: hidden folders,
 // duplicate URLs, and deletion tombstones survive subsequent imports.
 for(const profile of ['Profile 1','Profile 10']){
  const dir=path.join(ready.data,'Google/Chrome/User Data',profile);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{id:'1',type:'folder',children:[{id:'2',type:'folder',children:[{id:'3',type:'url',name:'Imported nested',url:'https://example.com/imported'}]}]}}}));
 }
 const sync=async()=>(await fetch(base.origin+'/api/bookmarks/chrome',{method:'POST',headers,body:JSON.stringify({enabled:true})})).json();
 await sync();items=await (await fetch(base.origin+'/api/bookmarks',{headers})).json();
 const imported=items.filter(b=>b.url==='https://example.com/imported');assert.equal(imported.length,2);assert(imported.every(b=>b.parentId===null));
 await post({id:imported[0].id,remove:true});await sync();
 items=await (await fetch(base.origin+'/api/bookmarks',{headers})).json();assert(!items.some(b=>b.url==='https://example.com/imported'));
 console.log('PASS: deep legacy bookmarks are flat, category hover/register, rename/search, persistence and cross-window category/delete sync');
}finally{await browser.close();await fetch(base.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});child.kill();}
