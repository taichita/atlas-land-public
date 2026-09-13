import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {uploadImage,selectedImages,imageInputs,imagePath} from '../server/images.mjs';
import {requestResponse,validateForm} from '../public/approval-forms.js';
import {DesktopSync} from '../server/sync.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=','base64');
test('image uploads stay in local storage and only task-owned IDs become image inputs',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-images-')),task={};
 const image=await uploadImage(dir,task,Readable.from([png]),'../photo.png');
 assert.equal(image.mime,'image/png');assert.equal(image.sentAt,null);
 assert.deepEqual(await fs.readFile(imagePath(dir,image)),png);
 assert.deepEqual(imageInputs(dir,selectedImages(task,[image.id])),[{type:'localImage',path:imagePath(dir,image)}]);
 assert.throws(()=>selectedImages({},[image.id]),/見つかりません/);
 assert.throws(()=>selectedImages(task,[image.id,image.id]),/指定/);
 await assert.rejects(uploadImage(dir,task,Readable.from([Buffer.from('<svg/>')]),'fake.png'),/PNG/);
 await assert.rejects(uploadImage(dir,task,Readable.from([Buffer.alloc(12*1024*1024+1)]),'large.png'),/12MB/);
});
test('elicitation replies preserve typed answers and distinguish refusal from cancellation',()=>{
 const schema={type:'object',properties:{allow:{type:'boolean'},choice:{type:'string',oneOf:[{const:'a',title:'A'}]},n:{type:'integer',minimum:1}},required:['allow','choice']};
 const r={id:'string:1',method:'mcpServer/elicitation/request',params:{mode:'form',requestedSchema:schema}};
 assert.deepEqual(requestResponse(r,{decision:'accept',content:{allow:false,choice:'a',n:2}}),{action:'accept',content:{allow:false,choice:'a',n:2}});
 assert.throws(()=>requestResponse(r,{decision:'accept',content:{allow:'true',choice:'a'}}),/確認/);
 assert.throws(()=>validateForm(schema,{allow:true,choice:'b'}),/確認/);
 assert.deepEqual(requestResponse(r,{decision:'cancel',content:{allow:true}}),{action:'cancel',content:null});
 assert.deepEqual(requestResponse(r,{decision:'decline'}),{action:'decline',content:null});
 assert.throws(()=>requestResponse({method:'item/commandExecution/requestApproval',params:{availableDecisions:['decline']}},{decision:'accept'}),/選択/);
});
test('desktop image messages pass explicit local references without resuming the other executor',async()=>{
 const calls=[],t={id:'desktop',external:true,edits:[]};
 const sync=new DesktopSync({store:{data:{desktopContextId:'context',agentPolicy:''}},update(){},emit(){},bridge:{call(){throw Error('do not resume');}},desktop:{ready:async()=>{},call:async(...args)=>{calls.push(args);return {ok:true};}}});
 sync.touch=()=>{};await sync.send(t,{text:'画像を確認して',imagePaths:['C:\\local\\clip.png']});
 assert.equal(calls[0][0],'send_message_to_thread');assert.match(calls[0][1].prompt,/clip\.png/);assert.equal(calls[0][1].threadId,'desktop');
});
