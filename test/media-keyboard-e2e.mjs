// Real browser key events, with the narrow native media transport simulated.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const context=await browser.newContext();
 await context.route('https://atlas-media.test/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/child')?'<video></video><video></video>':'<input><div id="shadow"></div><video></video><video></video><iframe src="https://atlas-media.test/child"></iframe>'}));
 await context.addInitScript(()=>{
  const listeners=[];window.chrome||={};window.chrome.webview={
   addEventListener(_,cb){listeners.push(cb);},
   postMessage(m){if(m.type==='atlas.mediaStep')listeners.forEach(cb=>cb({data:{channel:'gpt-atlas-media-v1',kind:'apply',delta:m.delta}}));}
  };
  window.setMediaSettings=settings=>listeners.forEach(cb=>cb({data:{channel:'gpt-atlas-media-v1',kind:'settings',...settings}}));
 });
 await context.addInitScript({path:'native/media-shortcuts.js'});
 const page=await context.newPage();await page.goto('https://atlas-media.test/');
 const child=page.frames().find(f=>f.url().endsWith('/child'));
 await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<video></video>');
 await page.keyboard.press('v');
 await page.waitForFunction(()=>document.querySelector('video').playbackRate===1.25);
 await child.waitForFunction(()=>document.querySelector('video').playbackRate===1.25);
 assert.equal(await page.evaluate(()=>document.querySelector('#shadow').shadowRoot.querySelector('video').playbackRate),1.25);
 await child.locator('video').first().click({force:true});await page.keyboard.press('z');
 await page.waitForFunction(()=>document.querySelector('video').playbackRate===1);
 await child.waitForFunction(()=>document.querySelector('video').playbackRate===1);
 await page.locator('input').fill('');await page.keyboard.type('vz');
 assert.equal(await page.locator('input').inputValue(),'vz');
 assert.equal(await page.locator('video').first().evaluate(v=>v.playbackRate),1);
 await page.evaluate(()=>{document.activeElement.blur();window.setMediaSettings({enabled:false});});
 await page.keyboard.press('v');assert.equal(await page.locator('video').first().evaluate(v=>v.playbackRate),1);
 console.log('Media keyboard passed: V/Z across document, child frame and Shadow DOM; typing and disabled mode unaffected.');
} finally {await browser.close();}
