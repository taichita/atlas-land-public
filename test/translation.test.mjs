import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PageTranslator,translationConfig,validateTexts} from '../server/translation.mjs';
test('translation bounds and tool configuration',()=>{
 assert.throws(()=>validateTexts(['x'.repeat(3001)]));assert.throws(()=>validateTexts(Array(181).fill('x')));
 assert.throws(()=>validateTexts([{}]));assert.throws(()=>validateTexts(Array(10).fill('x'.repeat(2500))));
 const c=translationConfig({mcp_servers:{browser:{}},plugins:{example:{}}});
 assert.equal(c['mcp_servers.browser.enabled'],false);assert.equal(c['plugins.example.enabled'],false);assert.equal(c['features.shell_tool'],false);
});
test('translation uses ephemeral threads, validates output and always releases listeners',async()=>{
 class Fake extends EventEmitter{async ready(){} async call(method,p){this.calls.push([method,p]);
   if(method==='config/read')return {config:{}};
   if(method==='thread/start')return {thread:{id:'translation'}};
   if(method==='turn/start'){queueMicrotask(()=>{this.emit('notification',{method:'item/completed',params:{threadId:'translation',item:{type:'agentMessage',text:JSON.stringify({translations:['保存']})}}});this.emit('notification',{method:'turn/completed',params:{threadId:'translation',turn:{status:'completed'}}});});return {turn:{id:'turn'}};}
   return {};
 }}
 const bridge=new Fake();bridge.calls=[];const translator=new PageTranslator(bridge,'C:\\isolated');
 assert.deepEqual(await translator.translate(['Save']),['保存']);
 assert.equal(bridge.calls.find(x=>x[0]==='thread/start')[1].ephemeral,true);
 assert.equal(bridge.listenerCount('notification'),0);assert.equal(translator.busy,false);
 assert.equal(bridge.calls.at(-1)[0],'thread/unsubscribe');
 await assert.rejects(translator.translate(['Save','Cancel']));assert.equal(translator.busy,false);
});
