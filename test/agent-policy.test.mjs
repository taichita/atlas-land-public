import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy,atlasEnvironment,policyFor,policyHash,policyUpdate} from '../server/agent-policy.mjs';
test('policy is sent once per revision; clearing it sends a reset once',()=>{
 const task={};assert.equal(policyFor({}),atlasEnvironment+'\n'+defaultPolicy);
 assert(policyUpdate(task,defaultPolicy));task.agentPolicyHash=policyHash(defaultPolicy);
 assert.equal(policyUpdate(task,defaultPolicy),'');assert(policyUpdate(task,'new rules'));
 assert.match(policyUpdate(task,''),/解除/);task.agentPolicyHash=policyHash('');
 assert.equal(policyUpdate(task,''),'');assert.equal(policyFor({agentPolicy:''}),atlasEnvironment+'\n');
});
test('saved custom rules still receive the current Atlas environment and invalidate the old policy hash',()=>{
 const data={agentPolicy:'custom'},task={agentPolicyHash:policyHash('custom')};
 assert.match(policyUpdate(task,policyFor(data)),/Atlas Browser/);assert(policyFor(data).endsWith('custom'));
 task.agentPolicyHash=policyHash(policyFor(data));assert.equal(policyUpdate(task,policyFor(data)),'');
});
