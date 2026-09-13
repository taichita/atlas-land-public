import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNote,saveNote} from '../server/notes.mjs';
test('notes create uniquely, preserve collisions and externally edited files, and save Unicode under a chosen name',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-notes-'));
 const a=await createNote(folder),b=await createNote(folder);assert.notEqual(a.path,b.path);
 const target=path.join(folder,'感想.md');await fs.writeFile(target,'既存');
 await assert.rejects(saveNote(a.path,{folder,name:'感想.md',text:'メモ本文',version:a.version},folder),/同名/);
 assert.equal(await fs.readFile(target,'utf8'),'既存');assert.equal(await fs.readFile(a.path,'utf8'),'');
 for(const name of ['../escape.txt','CON.txt','x.exe'])await assert.rejects(saveNote(a.path,{folder,name,text:'内容',version:a.version},folder));
 const saved=await saveNote(a.path,{folder,name:'新しいメモ.txt',text:'本を読んだ感想。\n続きを書く。',version:a.version},folder);
 assert.equal(await fs.readFile(saved.path,'utf8'),'本を読んだ感想。\n続きを書く。');await assert.rejects(fs.stat(a.path));
 await fs.writeFile(b.path,'別のエディターによる変更');
 await assert.rejects(saveNote(b.path,{folder,name:'別.txt',text:'上書き',version:b.version},folder),/更新/);
 assert.equal(await fs.readFile(b.path,'utf8'),'別のエディターによる変更');
});
