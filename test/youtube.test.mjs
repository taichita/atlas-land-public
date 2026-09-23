import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {YouTube,retentionRows,videoId} from '../server/youtube.mjs';

test('retention uses named columns, retains repeat-view ratios above 100%, rejects invalid points',()=>{
  assert.deepEqual(retentionRows({columnHeaders:[{name:'audienceWatchRatio'},{name:'elapsedVideoTimeRatio'}],rows:[[1.3,0.1],[0.4,0.9],[-1,0.2],[1,2]]}),[{position:0.1,ratio:1.3},{position:0.9,ratio:0.4}]);
  assert.throws(()=>videoId('../escape'));assert.equal(videoId('abcDEF12345'),'abcDEF12345');
});
test('OAuth verifies state and PKCE, stores tokens locally, reports do not expose them',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-youtube-')),calls=[];
  const youtube=new YouTube(dir,{fetcher:async(url,options)=>{calls.push({url:String(url),options});return Response.json(String(url).includes('/token')?{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}:{columnHeaders:[{name:'elapsedVideoTimeRatio'},{name:'audienceWatchRatio'}],rows:[[0.1,1.2],[0.5,0.4]]});}});
  try{
    await assert.rejects(youtube.retention('abcDEF12345'),/接続/);
    await youtube.configure({installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture-secret'}});
    const auth=new URL((await youtube.authorize()).url),callback=new URL(auth.searchParams.get('redirect_uri'));
    assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.match(auth.searchParams.get('scope'),/yt-analytics.readonly/);
    callback.search=new URLSearchParams({state:'wrong',code:'wrong'});assert.equal((await fetch(callback)).status,400);assert.equal(calls.length,0);
    callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code'});assert.equal((await fetch(callback)).status,200);
    assert(calls[0].options.body.get('code_verifier'));
    assert.deepEqual(await youtube.status(),{configured:true,connected:true});
    const report=await youtube.retention('abcDEF12345');assert.equal(report.points[0].ratio,1.2);
    await youtube.retention('abcDEF12345');assert.equal(calls.length,2);
    assert.equal(new URL(calls[1].url).searchParams.get('ids'),'channel==MINE');assert(!JSON.stringify(report).includes('fixture-access'));
    const capture=await youtube.capture({videoId:'abcDEF12345',title:'日本語',transcript:'[00:00] 原文',screenshot:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='});
    assert((await fs.readFile(capture.path,'utf8')).includes('[00:00] 原文'));assert.equal((await fs.stat(capture.image)).size,68);
  }finally{youtube.close();}
});
