import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPolicy,policyFor,policyHash,policyUpdate} from '../server/agent-policy.mjs';
test('policy is sent once per revision; clearing it sends a reset once',()=>{
 const task={};assert.equal(policyFor({}),defaultPolicy);
 assert(policyUpdate(task,defaultPolicy));task.agentPolicyHash=policyHash(defaultPolicy);
 assert.equal(policyUpdate(task,defaultPolicy),'');assert(policyUpdate(task,'new rules'));
 assert.match(policyUpdate(task,''),/解除/);task.agentPolicyHash=policyHash('');
 assert.equal(policyUpdate(task,''),'');assert.equal(policyFor({agentPolicy:''}),'');
});
