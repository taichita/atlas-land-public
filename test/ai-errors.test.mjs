import test from 'node:test';
import assert from 'node:assert/strict';
import {usageLimited,aiErrorText} from '../public/ai-errors.js';
test('quota is distinguished from transport errors and ordinary HTTP throttling',()=>{
 for(const e of [{codexErrorInfo:'UsageLimitExceeded'},{data:{codexErrorInfo:'usageLimitExceeded'}},{message:"You've hit your usage limit"}]){
  assert.equal(usageLimited(e),true);assert.match(aiErrorText(e),/Web閲覧・ファイル編集/);
 }
 for(const e of [null,{message:'HTTP 429 Too Many Requests'},'接続が切れました','Command failed'])assert.equal(usageLimited(e),false);
 assert.equal(aiErrorText('通信エラー'),'通信エラー');
});
