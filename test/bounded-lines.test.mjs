import test from 'node:test';
import assert from 'node:assert/strict';
import {BoundedLines} from '../server/bounded-lines.mjs';
import {readTurnHistory} from '../server/turn-history.mjs';

test('oversized fragmented JSONL is discarded with bounded memory; next UTF-8 response survives',()=>{
  const lines=[];let overflows=0;
  const reader=new BoundedLines({maxBytes:1024,onLine:line=>lines.push(JSON.parse(line)),onOverflow:()=>overflows++});
  const chunk=Buffer.alloc(513,97);
  for(let i=0;i<10000;i++){reader.write(chunk);assert(reader.bytes<=1024);assert(reader.parts.length<=2);}
  assert.equal(overflows,1);
  const valid=Buffer.from('\n'+JSON.stringify({id:2,result:'日本語 🌏'})+'\r\n');
  for(const byte of valid)reader.write(Buffer.from([byte]));
  reader.write(Buffer.from('{"id":3}\n{"id":4}\n'));
  assert.deepEqual(lines,[{id:2,result:'日本語 🌏'},{id:3},{id:4}]);
});

test('large history falls back once and keeps pagination; other failures are not retried',async()=>{
  const calls=[];
  const bridge={async call(method,params){calls.push({method,...params});if(params.itemsView==='full')throw Object.assign(Error('large'),{code:'ATLAS_RESPONSE_TOO_LARGE'});return {data:[{id:'t',items:[{type:'agentMessage',text:'kept'}]}],nextCursor:'older'};}};
  const result=await readTurnHistory(bridge,{threadId:'thread',limit:2});
  assert(result.compactHistory);assert.equal(result.data[0].items[0].text,'kept');
  await readTurnHistory(bridge,{threadId:'thread',cursor:result.nextCursor,limit:8});
  assert.deepEqual(calls.map(c=>c.itemsView),['full','summary','summary']);assert.equal(calls[2].cursor,'older');
  let attempts=0;
  await assert.rejects(readTurnHistory({async call(){attempts++;throw Error('offline');}},{threadId:'other'}),/offline/);
  assert.equal(attempts,1);
});
