import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freshWorkspace,windowState} from '../server/windows.mjs';
import {ChromeBookmarks} from '../server/chrome-bookmarks.mjs';
import {Connections} from '../server/connections.mjs';

test('fresh launch clears every window layout but preserves tasks, drafts and preferences',()=>{
 const ui={active:'task',open:['task'],viewTabs:[{key:'task:task'}],activeView:'task:task',rightPane:{},paneWorkspace:{panes:[{}]},drafts:{task:'unfinished'},theme:'purple',sidebarHidden:true};
 const data={ui,windows:{main:{ui:structuredClone(ui),tabs:[{id:'web'}]},second:{ui:structuredClone(ui)}},tabs:[{id:'web'}],tasks:[{id:'task'}],noteFolder:'notes'};
 freshWorkspace(data);
 for(const value of [data,...Object.values(data.windows)]){assert.deepEqual(value.ui.viewTabs,[]);assert.deepEqual(value.ui.paneWorkspace.panes,[]);assert.deepEqual(value.tabs,[]);assert.equal(value.ui.drafts.task,'unfinished');assert(value.ui.sidebarHidden);}
 assert.equal(data.tasks[0].id,'task');assert.equal(data.noteFolder,'notes');
 assert.deepEqual(windowState(data,'third').ui.paneWorkspace.panes,[]);
});

test('Chrome sync is idempotent, read-only, retains local edits and ignores unsafe URLs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-chrome-'));
 const file=path.join(root,'Default','Bookmarks');await fs.mkdir(path.dirname(file));
 const doc={roots:{bookmark_bar:{id:'1',name:'ブックマークバー',type:'folder',children:[{id:'2',type:'url',name:'Example',url:'https://example.org/'},{id:'3',type:'url',name:'Bad',url:'javascript:alert(1)'}]}}};
 const store={data:{bookmarks:[{id:'own',title:'My bookmark',url:'https://example.com/'}]},flush(){}};
 const sync=new ChromeBookmarks(store,{root});
 try{
  await fs.writeFile(file,JSON.stringify(doc));assert((await sync.sync(true)).changed);
  assert.equal(store.data.bookmarks.filter(b=>b.url).length,2);assert(!(await sync.sync(true)).changed);
  assert(!store.data.bookmarks.some(b=>b.kind==='folder'));
  assert(store.data.bookmarks.every(b=>!b.parentId));
  const item=store.data.bookmarks.find(b=>b.title==='Example');item.chromeEdited=true;item.title='自分の名前';
  doc.roots.bookmark_bar.children[0].name='Upstream change';await fs.writeFile(file,JSON.stringify(doc));await sync.sync(true);
  assert.equal(store.data.bookmarks.find(b=>b.id===item.id).title,'自分の名前');
  await fs.writeFile(file,'incomplete');assert.equal((await sync.sync(true)).errors.length,1);assert(store.data.bookmarks.some(b=>b.id===item.id));
  item.chromeEdited=false;store.data.chromeBookmarkHidden=[item.id];await fs.writeFile(file,JSON.stringify(doc));await sync.sync(true);
  assert(!store.data.bookmarks.some(b=>b.id===item.id));assert.equal(await fs.readFile(file,'utf8'),JSON.stringify(doc));
 }finally{await fs.rm(root,{recursive:true});}
});

test('voice config never exposes secrets and legacy Groq key is read without copying it',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-voice-')),legacy=path.join(dir,'legacy.env');
 await fs.writeFile(legacy,'GROQ_API_KEY="fixture-secret"\n');let calls=0;
 const connection=new Connections(dir,{env:{},legacyGroqFile:legacy,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(options.headers.Authorization,'Bearer fixture-secret');
  assert.equal(options.body.get('language'),'ja');assert.equal(options.body.get('file').size,3);return new Response(JSON.stringify({text:'入力した言葉'}));
 }});
 try{
  assert.equal((await connection.status()).voice[0].configured,true);assert(!JSON.stringify(await connection.status()).includes('fixture-secret'));
  await connection.ensureFile();await connection.save({openai:{apiKey:'other-fixture'}});
  assert(!(await fs.readFile(connection.file,'utf8')).includes('fixture-secret'));
  assert.equal((await connection.transcribe(Buffer.from('abc'),'audio/webm')).text,'入力した言葉');assert.equal(calls,1);
  await assert.rejects(connection.transcribe(Buffer.from('abc'),'text/html'),/音声形式/);
  connection.fetcher=async()=>{throw Error('fixture-secret');};await assert.rejects(connection.transcribe(Buffer.from('abc'),'audio/webm'),e=>!e.message.includes('fixture-secret'));
  assert.equal(calls,1);
 }finally{await fs.rm(dir,{recursive:true});}
});
