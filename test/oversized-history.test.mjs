import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

test('oversized App Server history cannot take down draft persistence or subsequent RPCs', {timeout:20000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-large-history-'));
  // This fixture generates output larger than the production guard, without
  // any account, user history, or network model calls.
  await fs.writeFile(path.join(dir,'app-server'),`const rl=require('node:readline');
    rl.createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);if(m.id===undefined)return;
      let result={};
      if(m.method==='model/list')result={data:[]};
      if(m.method==='thread/turns/list'){
        if(m.params.itemsView==='full')result={data:'x'.repeat(17*1024*1024)};
        else result={data:[{id:'turn',items:[{id:'reply',type:'agentMessage',text:'still readable'}]}],nextCursor:null};
      }
      process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
    });`);
  await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({tasks:[{id:'large',title:'fixture',cwd:dir,hasConversation:true,turnStartedAt:1,state:'completed',files:[],events:[],edits:[]}],links:[],tabs:[]}));
  const env={...process.env,AI_WORKSPACE_DATA:dir,AI_WORKSPACE_CODEX:process.execPath,CODEX_HOME:path.join(dir,'codex'),LOCALAPPDATA:dir,GPT_ATLAS_DESKTOP_SYNC:'0',ATLAS_FRESH_SESSION:'0'};
  delete env.ATLAS_SERVICE_PORT;delete env.ATLAS_SERVICE_TOKEN;
  const child=spawn(process.execPath,[path.resolve('server/main.mjs')],{cwd:dir,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',b=>errors+=b);
  try{
    const ready=await new Promise((resolve,reject)=>{createInterface({input:child.stdout}).once('line',line=>resolve(JSON.parse(line)));child.once('exit',code=>reject(Error('exit '+code+errors)));});
    const url=new URL(ready.url),headers={'x-workspace-token':url.hash.slice(1),'content-type':'application/json'};
    const api=async(p,data)=>{const r=await fetch(url.origin+'/api'+p,{headers,method:data?'POST':'GET',...(data?{body:JSON.stringify(data)}:{})});assert.equal(r.status,200);return r.json();};
    const history=await api('/tasks/large/history');assert(history.compactHistory);assert.equal(history.data[0].items[0].text,'still readable');
    await api('/preferences',{drafts:{large:'draft after large response'}});
    const disk=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.equal(disk.ui.drafts.large,'draft after large response');
    assert((await api('/tasks/large/history')).compactHistory);assert.equal(child.exitCode,null);assert(!errors.includes('RangeError'));
  }finally{child.kill();}
});
