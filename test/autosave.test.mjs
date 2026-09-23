import test from 'node:test';
import assert from 'node:assert/strict';
import {Autosave} from '../public/autosave.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('writes are ordered and only the newest pending draft follows an in-flight save',async()=>{
  const first=deferred(),writes=[],cache=[];let cleared=0;
  const saver=new Autosave({delay:60000,save:async v=>{writes.push(v);if(writes.length===1)await first.promise;},cache:v=>cache.push(v),clearCache:()=>cleared++});
  saver.queue({text:'first'});const saving=saver.flush();
  saver.queue({text:'second'});saver.queue({text:'last'});
  first.resolve();await saving;clearTimeout(saver.timer);
  assert.deepEqual(writes,[{text:'first'},{text:'last'}]);assert.equal(cleared,1);assert.equal(cache.at(-1).text,'last');
});

test('offline errors notify once, keep recovery copy, retry latest text and clear only after acknowledgement',async()=>{
  let offline=true,warnings=0,copy=null;const writes=[];
  const saver=new Autosave({delay:60000,retryDelay:10,save:async v=>{if(offline)throw Error('offline');writes.push(v);},cache:v=>copy=v,clearCache:()=>copy=null,onError:()=>warnings++});
  saver.queue({text:'draft'});await assert.rejects(saver.flush(),/offline/);
  saver.queue({text:'edited offline'});await assert.rejects(saver.flush(),/offline/);
  assert.equal(warnings,1);assert.equal(copy.text,'edited offline');offline=false;
  await new Promise(r=>setTimeout(r,60));clearTimeout(saver.timer);
  assert.deepEqual(writes,[{text:'edited offline'}]);assert.equal(copy,null);
});
