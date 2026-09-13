import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['test/ui-session.mjs',process.argv[2]||'.',...(process.argv[3]?[process.argv[3]]:[])],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const ready=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',l=>resolve(JSON.parse(l)));child.once('error',reject);});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(10000);
const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1)};
try {
 await page.goto(ready.url);
 const right=page.frameLocator('#secondary-frame');
 await page.locator('#editor-name').filter({hasText:'review.md'}).waitFor();
 await right.locator('#editor-name').filter({hasText:'preview.html'}).waitFor();
 await page.locator('#edit-mode').click();
 await page.locator('#text-editor').fill('# Left pane saved\n\n左右の編集確認');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/local/file')&&r.request().method()==='POST'&&r.status()===200),page.locator('#save-file').click()]);
 await page.waitForFunction(()=>document.querySelector('#save-file').disabled);
 assert.match(await fs.readFile(ready.note,'utf8'),/Left pane saved/);
 await page.locator('#pane-swap').click();
 await right.locator('#text-editor').waitFor();
 await right.locator('#text-editor').fill('# Right pane saved\n\n右側から保存');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/local/file')&&r.request().method()==='POST'&&r.status()===200),right.locator('#save-file').click()]);
 await page.waitForFunction(()=>document.querySelector('#secondary-frame').contentDocument.querySelector('#save-file').disabled);
 assert.match(await fs.readFile(ready.note,'utf8'),/Right pane saved/);
 const html=page.frameLocator('#editor-content iframe');
 await html.getByRole('button',{name:'動作確認',exact:true}).click();
 assert.match(await html.locator('body').innerText(),/動作確認OK/);
 const primaryBefore=await page.locator('#primary-slot').boundingBox();
 await page.locator('#workspace-divider').focus();await page.keyboard.press('ArrowRight');
 const primaryAfter=await page.locator('#primary-slot').boundingBox();assert(primaryAfter.width>primaryBefore.width);
 await page.locator('#pane-swap').click();
 await page.locator('#text-editor').waitFor();assert.match(await page.locator('#text-editor').inputValue(),/Right pane saved/);
 await page.getByRole('button',{name:'＋ Web',exact:true}).click();
 assert.equal(await page.locator('#panes').isVisible(),false);
 assert.equal(await page.locator('#secondary-frame').isVisible(),true);
 await page.locator('#work-tabs button[data-view]').filter({hasText:'review.md'}).click();
 await page.locator('#app-menu summary').click();await page.locator('#settings-button').click();await page.getByRole('button',{name:'実行方針',exact:true}).click();
 await page.locator('#agent-policy').fill('検証用の短い方針');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/agent-policy')&&r.request().method()==='POST'),page.locator('#policy-save').click()]);
 assert.equal((await (await fetch(url.origin+'/api/agent-policy',{headers})).json()).instructions,'検証用の短い方針');
 const nativePage=await browser.newPage();
 await nativePage.addInitScript(()=>{
  const callbacks=[];window.__host=[];window.chrome||={};window.chrome.webview={
   postMessage(m){window.__host.push(m);if(m.requestId)queueMicrotask(()=>callbacks.forEach(cb=>cb({data:{type:'response',requestId:m.requestId,result:true}})));},
   addEventListener(_,cb){callbacks.push(cb);}
  };
 });
 const linkedFile=path.join(ready.data,'完成した 原稿.md');await fs.writeFile(linkedFile,'# クリックして開いた原稿\n\nAtlas内の成果物。');
 await fs.writeFile(ready.note,`[完成した原稿](</${linkedFile.replaceAll('\\','/')}#L1>)`);
 await nativePage.goto(ready.url);await nativePage.locator('#read-mode').click();
 await nativePage.getByRole('link',{name:'完成した原稿',exact:true}).click();
 await nativePage.locator('#editor-name').filter({hasText:'完成した 原稿.md'}).waitFor();
 await nativePage.getByRole('heading',{name:'クリックして開いた原稿',exact:true}).waitFor();
 assert.equal(await nativePage.evaluate(()=>window.__host.filter(m=>m.action==='file.reveal'||m.action==='chooseFile').length),0);
 await nativePage.locator('#reveal-file').click();
 await nativePage.waitForFunction(()=>window.__host.filter(m=>m.action==='file.reveal').length===1);
 assert.equal(path.normalize(await nativePage.evaluate(()=>window.__host.find(m=>m.action==='file.reveal').path)),await fs.realpath(linkedFile));
 await nativePage.close();console.log('Policy settings and native reveal dispatch passed.');
 if(process.argv[3]){
  await page.locator('#work-tabs button[data-view]').filter({hasText:path.basename(process.argv[3])}).click();
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
  const video=page.locator('video');const duration=await video.evaluate(v=>v.duration);assert(duration>0);
  await video.evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>.2);
  await video.evaluate(v=>{v.pause();v.currentTime=v.duration/2;});
  await page.waitForFunction(()=>!document.querySelector('video').seeking);
  console.log('Video metadata, playback and seek passed; seconds='+duration);
 }
 assert.deepEqual(errors,[]);
 await fs.mkdir('.test-data',{recursive:true});
 await page.screenshot({path:'.test-data/ui-check.png'});
 console.log('UI passed: left/right edit-save, HTML/CSS/scripts, swap, width, Web+file. No page errors.');
} finally {
 await browser.close();
 await fetch(url.origin+'/api/shutdown',{method:'POST',headers}).catch(()=>{});
 child.kill();
}
