import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopRecovery} from '../server/desktop-recovery.mjs';
import {DesktopBridge} from '../server/desktop.mjs';
import {DesktopSync} from '../server/sync.mjs';

function fixture(options={}){
  let time=10*3600000,settings={},app={installed:true,running:false,healthy:true,version:'1'};
  const calls=[],events=[];
  const r=new DesktopRecovery({now:()=>time,settings:()=>settings,save:p=>Object.assign(settings,p),emit:e=>events.push(e),system:async action=>{calls.push(action);return {...app};},upgrade:async()=>{calls.push('upgrade');},...options});
  return {r,calls,events,app,settings,advance:n=>{time+=n;}};
}
test('outage grace, startup backoff, update only after failed launch, bounded retries',async()=>{
  const f=fixture();await f.r.failed();assert.deepEqual(f.calls,[]);
  f.advance(20000);await f.r.failed();assert.deepEqual(f.calls,['inspect','launch']);
  await f.r.failed();assert.equal(f.calls.length,2);
  f.advance(60000);await f.r.failed();assert.deepEqual(f.calls.slice(2),['inspect','inspect','upgrade','launch']);
  f.advance(120000);await f.r.failed();assert.equal(f.calls.filter(c=>c==='launch').length,3);
  f.advance(240000);await f.r.failed();assert.equal(f.r.status().phase,'cooldown');
  await f.r.failed({force:true});assert.equal(f.calls.filter(c=>c==='launch').length,3);
  assert.equal(f.calls.filter(c=>c==='upgrade').length,1);
});
test('running, missing, deploying and unreadable process states never launch/update',async()=>{
  for(const patch of [{running:true},{installed:false},{healthy:false}]){
    const f=fixture();Object.assign(f.app,patch);await f.r.failed({force:true});assert.deepEqual(f.calls,['inspect']);
  }
  const f=fixture({system:async()=>{throw Error('access denied');}});await f.r.failed({force:true});assert.equal(f.r.status().phase,'unavailable');
});
test('single flight, disable while inspecting, and explicit manual recovery',async()=>{
  let resolve;const f=fixture({system:action=>action==='inspect'?new Promise(r=>{resolve=r;}):Promise.resolve(f.app)});
  const one=f.r.failed({force:true});assert.equal(f.r.failed({force:true}),one);resolve(f.app);await one;
  const disabled=fixture();disabled.settings.enabled=false;await disabled.r.failed();assert.deepEqual(disabled.calls,[]);
  await disabled.r.failed({force:true});assert.deepEqual(disabled.calls,['inspect','launch']);
  const stopping=fixture({system:async()=>{stopping.settings.enabled=false;return stopping.app;}});
  await stopping.r.failed();stopping.advance(20000);await stopping.r.failed();assert.equal(stopping.r.status().phase,'paused');
});
test('updates can be disabled, failures still permit launch and are explained',async()=>{
  const f=fixture({upgrade:async()=>{throw Error('Store requires sign in');}});
  await f.r.failed({force:true});f.advance(60000);await f.r.failed();assert.equal(f.calls.filter(c=>c==='launch').length,2);assert.match(f.r.status().message,/Store/);
  const off=fixture();off.settings.autoUpdate=false;await off.r.failed({force:true});off.advance(60000);await off.r.failed();assert(!off.calls.includes('upgrade'));
});
test('app starting between update checks defers installation; healthy connection resets outage',async()=>{
  let inspects=0;const f=fixture({system:async action=>{f.calls.push(action);return {...f.app,running:action==='inspect'&&++inspects===3};}});
  await f.r.failed({force:true});f.advance(60000);await f.r.failed();assert(!f.calls.includes('upgrade'));assert.equal(f.calls.filter(c=>c==='launch').length,1);
  f.r.healthy();assert.equal(f.r.status().phase,'connected');await f.r.failed();assert.equal(inspects,3);
});
test('transport reset preserves an in-flight mutation; idle reset permits fresh discovery',()=>{
  const d=new DesktopBridge();let destroyed=0;d.socket={destroy(){destroyed++;}};
  d.pending.set(1,{});assert.equal(d.reset(),false);assert.equal(destroyed,0);
  d.pending.clear();assert.equal(d.reset(),true);assert.equal(destroyed,1);assert.equal(d.socket,null);
});
test('recovery refreshes synchronization and never sends or resumes a conversation',async()=>{
  const calls=[];let available=false,launched=0;
  const sync=new DesktopSync({store:{data:{desktopContextId:'context',tasks:[{external:true,hasConversation:true,stored:true}]}},emit(){},recovery:{healthy(){},status(){return {};},async failed({force=false}={}){if(force){launched++;available=true;}}},desktop:{async ready(){if(!available)throw Error('offline');},reset(){},async call(name){calls.push(name);return {threads:[]};}}});
  await sync.recover();assert.equal(launched,1);await sync.touch(null,true);assert.equal(sync.available,true);assert.deepEqual(calls,['list_threads']);
});
test('a failed list cannot become connected just because the next tick has no active targets',async()=>{
  let attempts=0,healthy=0;
  const sync=new DesktopSync({store:{data:{desktopContextId:'context',tasks:[]}},emit(){},recovery:{healthy(){healthy++;}},desktop:{async ready(){attempts++;throw Error('offline');}}});
  await sync.touch(null,true);sync.lastTick=0;await sync.touch(null);
  assert.equal(sync.available,false);assert.equal(attempts,2);assert.equal(healthy,0);
});
