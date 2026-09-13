import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fail,readLocalFile,saveLocalFile} from './files.mjs';
export async function noteFolder(value){
  if(typeof value!=='string'||!path.isAbsolute(value)||value.startsWith('\\\\'))fail('作業フォルダを選んでください');
  const folder=await fs.realpath(value);if(!(await fs.stat(folder)).isDirectory())fail('フォルダを選んでください');return folder;
}
export async function createNote(folder){
  folder=await noteFolder(folder);
  const name='無題-'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'-'+crypto.randomBytes(3).toString('hex')+'.txt';
  const file=path.join(folder,name);await fs.writeFile(file,'',{flag:'wx'});
  return {...await readLocalFile(file),ext:'txt',local:true,untitled:true,mode:'edit',original:'',dirty:false};
}
export async function saveNote(source,input,backupDir){
  const folder=await noteFolder(input.folder),name=String(input.name||'').trim();
  if(!name||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))fail('ファイル名を確認してください');
  if(!/\.(txt|md|markdown|csv|tsv|json)$/i.test(name))fail('拡張子は .txt / .md / .csv / .tsv / .json を指定してください');
  if(typeof input.text!=='string'||input.text.length>2*1024*1024)fail('メモは2MB以内にしてください');
  const current=await readLocalFile(source),target=path.join(folder,name);
  if(current.version!==input.version)fail('無題ファイルが別の操作で更新されています。内容を確認してください',409);
  if(target.toLowerCase()===current.path.toLowerCase())return {...await saveLocalFile(source,input,backupDir),ext:path.extname(target).slice(1),local:true,untitled:false};
  try{await fs.writeFile(target,input.text,{encoding:'utf8',flag:'wx'});}catch(e){if(e.code==='EEXIST')fail('同名のファイルがあります。別の名前を指定してください',409);throw e;}
  const saved=await readLocalFile(target);
  // A failure to remove the old placeholder must never undo the saved note.
  let retained=false;
  try{if((await readLocalFile(source)).version===current.version)await fs.unlink(source);else retained=true;}catch{retained=true;}
  return {...saved,ext:path.extname(target).slice(1),local:true,untitled:false,retained};
}
