import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.route('https://www.youtube.com/**',route=>route.request().url().includes('/api/timedtext')?route.fulfill({json:{events:[{tStartMs:1200,segs:[{utf8:'字幕の原文です'}]}]}}):route.fulfill({contentType:'text/html',body:'<body style="background:#18151e"><ytd-watch-flexy><div id="movie_player"></div><video></video><div id="secondary-inner" style="width:420px"></div></ytd-watch-flexy></body>'}));
  await page.goto('https://www.youtube.com/watch?v=abcDEF12345');
  await page.evaluate(()=>{
    window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m)}};
    // Open the shadow root only in this isolated fixture for assertions.
    const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
    document.querySelector('#movie_player').getPlayerResponse=()=>({videoDetails:{title:'日本語の動画タイトル <script>literal</script>',author:'テストチャンネル',lengthSeconds:1800},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'ja',baseUrl:'https://www.youtube.com/api/timedtext'}]}}});
  });
  // Match YouTube's Trusted Types restriction: injected UI must not use HTML sinks.
  await page.evaluate(()=>{const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="require-trusted-types-for 'script'";document.head.append(meta);});
  await page.evaluate(await fs.readFile('native/youtube-tools.js','utf8'));
  assert.equal(await page.locator('#atlas-youtube-tools').count(),1);
  await page.evaluate(()=>window.__atlasYouTube.render({videoId:'abcDEF12345',points:[{position:0,ratio:1.2},{position:0.5,ratio:0.6},{position:1,ratio:0.3}],fetchedAt:Date.now()}));
  assert.equal(await page.locator('#atlas-youtube-tools svg polyline').count(),1);
  await page.locator('#atlas-youtube-tools #preview').click();assert.match(await page.locator('#atlas-youtube-tools .title').textContent(),/<script>literal/);assert.equal(await page.locator('#atlas-youtube-tools script').count(),0);
  await page.evaluate(()=>window.__atlasYouTube.capture('fixture-request'));
  const captured=await page.evaluate(()=>window.messages.find(m=>m.action==='captured'));assert.equal(captured.payload.transcript,'[00:01] 字幕の原文です');
  await page.evaluate(()=>{history.pushState({},'','/watch?v=xyzDEF12345');document.dispatchEvent(new Event('yt-navigate-finish'));});
  await page.waitForFunction(()=>window.messages.some(m=>m.action==='retention'&&m.videoId==='xyzDEF12345'));
  assert.equal(await page.locator('#atlas-youtube-tools').count(),1);assert.equal(await page.locator('#atlas-youtube-tools svg').count(),0);
  await page.evaluate(()=>window.__atlasYouTube.render({videoId:'abcDEF12345',points:[{position:0,ratio:1}]}));assert.equal(await page.locator('#atlas-youtube-tools svg').count(),0);
  await page.evaluate(()=>{document.querySelector('#secondary-inner').style.display='none';document.body.append(document.createElement('ytd-watch-metadata'));document.querySelector('ytd-watch-metadata').style.display='block';window.dispatchEvent(new Event('resize'));});
  await page.waitForFunction(()=>document.querySelector('#atlas-youtube-tools')?.parentElement.tagName==='YTD-WATCH-METADATA');
  console.log('PASS: retention graph, recommendation card, timed transcript, SPA navigation and stale-response isolation.');
}finally{await browser.close();}
