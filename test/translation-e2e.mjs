import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 await page.route('http://translation.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://translation.test/');
 await page.setContent('<main><h1>Account settings</h1><button id="save">Save changes</button><p>Never share your secret key.</p><input value="private input"><textarea>private draft</textarea><code>private code</code><div contenteditable>private edit</div><div hidden>hidden secret</div><span>sk-abcdefghijklmnopqrstuvwxyz0123456789</span><div id="dynamic"></div></main>');
 const script=await fs.readFile('native/page-translation.js','utf8');
 await page.evaluate(source=>{window.translate=eval('('+source+')');window.clicked=0;document.querySelector('#save').addEventListener('click',()=>window.clicked++);},script);
 const snapshot=await page.evaluate(()=>window.translate('collect'));
 assert.deepEqual(snapshot.items.map(x=>x.text),['Account settings','Save changes','Never share your secret key.']);
 const texts=['アカウント設定','変更を保存','シークレットキーを共有しないでください。'];
 const result=await page.evaluate(({snapshot,texts})=>window.translate('apply',{...snapshot,items:snapshot.items.map((x,i)=>({id:x.id,text:texts[i]}))}),{snapshot,texts});
 assert.equal(result.count,3);await page.locator('#save').click();assert.equal(await page.evaluate(()=>window.clicked),1);
 assert.equal(await page.locator('input').inputValue(),'private input');assert.equal(await page.locator('textarea').inputValue(),'private draft');
 assert.equal((await page.evaluate(()=>window.translate('collect'))).items.length,0);
 await page.evaluate(()=>document.querySelector('#dynamic').textContent='Create API key');
 const dynamic=await page.evaluate(()=>window.translate('collect'));assert.deepEqual(dynamic.items.map(x=>x.text),['Create API key']);
 await page.evaluate(()=>document.querySelector('#dynamic').textContent='Changed while translating');
 const stale=await page.evaluate(d=>window.translate('apply',{...d,items:d.items.map(x=>({id:x.id,text:'old result'}))}),dynamic);assert.equal(stale.count,0);
 assert.equal((await page.evaluate(d=>window.translate('apply',{...d,documentId:'old-page'}),snapshot)).stale,true);
 await page.evaluate(()=>window.translate('restore'));assert.equal(await page.locator('#save').textContent(),'Save changes');
 // Exercise the real toolbar controller with a deterministic native/service boundary.
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<select id="translate-provider"><option value="google">Google</option><option value="codex">Codex</option></select><button id="translate-page"></button><button id="translate-original"></button><input id="translate-auto" type="checkbox"><span id="browser-message"></span>');});
 const client=(await fs.readFile('public/page-translation.js','utf8')).replace(/^import[^\n]+\n/,'');
 await page.evaluate(source=>{window.googleTranslationURL=eval('('+source.replace('export function googleTranslationURL','function')+')');window.openedTranslations=[];},await fs.readFile('public/translation-url.js','utf8'));
 await page.evaluate(source=>{
   const setup=eval('('+source.replace('export function setupPageTranslation','function')+')');
   window.translationState={tabs:[{id:'web',url:location.href}],activeTab:'web',ui:{translationProvider:'codex'}};
   window.translationCalls=0;window.saved=0;window.errors=[];
   window.controller=setup({state:window.translationState,save:()=>window.saved++,toast:text=>window.errors.push(text),openWeb:async url=>window.openedTranslations.push(url),host:async(_,args)=>window.translate(args.mode,args.payload),api:async(_,body)=>{window.translationCalls++;return {translations:body.texts.map(text=>text==='Save changes'?'変更を保存':'日本語の文章')};}});
   window.controller.render();
 },client);
 await page.locator('#translate-page').click();await page.waitForFunction(()=>document.querySelector('#save').textContent==='変更を保存');
 await page.locator('#translate-original').click();assert.equal(await page.locator('#save').textContent(),'Save changes');
 await page.locator('#translate-auto').check();await page.waitForFunction(()=>document.querySelector('#save').textContent==='変更を保存');
 assert.equal(await page.evaluate(()=>window.saved),1);
 assert.deepEqual(await page.evaluate(()=>window.translationState.ui.translationOrigins),['http://translation.test']);
 await page.locator('#translate-auto').uncheck();const before=await page.evaluate(()=>window.translationCalls);
 await page.evaluate(()=>window.controller.event({type:'browser.translation-dirty',id:'web'}));assert.equal(await page.evaluate(()=>window.translationCalls),before);
 assert.deepEqual(await page.evaluate(()=>window.errors),[]);
 await page.evaluate(()=>{window.translationState.tabs[0].url='https://example.com/article';window.translationState.ui.translationOrigins=['https://example.com'];});
 await page.locator('#translate-provider').selectOption('google');assert(await page.locator('#translate-auto').isDisabled());
 await page.locator('#translate-page').click();assert.equal((await page.evaluate(()=>window.openedTranslations)).length,1);assert.equal(await page.evaluate(()=>window.translationCalls),before);
 await page.evaluate(()=>window.controller.event({type:'browser.translation-ready',id:'web',url:'https://example.com/article'}));assert.equal(await page.evaluate(()=>window.translationCalls),before);
 await page.evaluate(()=>{delete window.translationState.ui.translationProvider;window.controller.render();});assert.equal(await page.locator('#translate-provider').inputValue(),'google');
 console.log('PASS: visible text translation, form/code exclusion, live button handlers, dynamic content, stale-result guard, original restoration');
}finally{await browser.close();}
