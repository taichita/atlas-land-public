import test from 'node:test';
import assert from 'node:assert/strict';
import {applyInstallation,readInstallation} from '../server/installation.mjs';
import {CodexBridge} from '../server/codex.mjs';

test('internal setup defaults apply once and preserve existing personal settings',()=>{
 const data={tasks:[]};
 assert.equal(applyInstallation(data,{channel:'internal',workFolder:'C:\\Work',access:'workspace-write',chromeSync:false}),true);
 assert.equal(data.defaultAccess,'workspace-write');assert.equal(data.defaultFolder,'C:\\Work');assert.equal(data.chromeSync,false);
 assert.equal(applyInstallation(data,{channel:'internal',workFolder:'C:\\Other',access:'danger-full-access',chromeSync:true}),false);
 assert.equal(data.defaultAccess,'workspace-write');assert.equal(data.defaultFolder,'C:\\Work');assert.equal(data.chromeSync,false);
 assert.equal(applyInstallation({},null),false);
});
test('absent installer config keeps the developer environment untouched',async()=>{
 assert.equal(await readInstallation(new URL('./fixtures/no-installation.json',import.meta.url)),null);
});
test('Codex detection is deferred so the browser can start without Codex installed',()=>{
 const bridge=new CodexBridge();assert.equal(bridge.exe,null);assert.equal(bridge.proc,null);assert.equal(bridge.pending.size,0);
});
