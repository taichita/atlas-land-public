import crypto from 'node:crypto';
import {fail} from './files.mjs';
import {bookmarkMarks,bookmarkMark} from '../public/bookmark-marks.js';
export function editBookmark(list,input){
  const index=input.id?list.findIndex(b=>b.id===input.id):-1;
  if(input.id&&index<0)fail('ブックマークが見つかりません',404);
  if(input.remove){
    if(index<0)fail('ブックマークを選んでください');
    if(list.some(b=>b.parentId===input.id))fail('中の項目を移動してから削除してください');
    const target=list[index];
    for(let i=list.length-1;i>=0;i--)if(list[i].id===target.id||(target.url&&list[i].url===target.url)||(target.kind==='task'&&list[i].kind==='task'&&list[i].taskId===target.taskId))list.splice(i,1);
    return;
  }
  const previous=index<0?null:list[index],kind=previous?.kind||input.kind||'bookmark';
  if(input.mark!==undefined&&!bookmarkMarks.some(m=>m.id===input.mark))fail('マークを選んでください');
  const mark=bookmarkMark(input.mark??previous?.mark).id;
  const parentId=input.parentId===undefined?(previous?.parentId||null):(input.parentId||null);
  if(parentId&&!list.some(b=>b.id===parentId&&b.kind==='folder'))fail('保存先フォルダーが見つかりません');
  let ancestor=parentId;const seen=new Set();
  while(ancestor){if(ancestor===input.id||seen.has(ancestor))fail('このフォルダーには移動できません');seen.add(ancestor);ancestor=list.find(b=>b.id===ancestor)?.parentId;}
  if(kind==='folder'){
    const title=String(input.title||'').trim().slice(0,200);if(!title)fail('フォルダー名を入力してください');
    const value={id:input.id||crypto.randomUUID(),kind,title,parentId,createdAt:previous?.createdAt||Date.now()};
    if(index<0)list.unshift(value);else list[index]=value;return value;
  }
  if(kind==='task'){
    const taskId=input.taskId||previous?.taskId;if(typeof taskId!=='string'||!taskId)fail('案件を選んでください');
    const existing=list.find(b=>b.kind==='task'&&b.taskId===taskId&&b.id!==input.id);if(existing){if(input.mark!==undefined)existing.mark=mark;return existing;}
    const value={id:input.id||crypto.randomUUID(),kind,taskId,title:String(input.title||previous?.title||'案件').slice(0,200),parentId,mark,createdAt:previous?.createdAt||Date.now()};
    if(index<0)list.unshift(value);else list[index]=value;return value;
  }
  let url;try{url=new URL(input.url);}catch{fail('URLを確認してください');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>8000)fail('http / https のページを指定してください');
  const existing=list.find(b=>b.url===url.href&&b.id!==input.id);
  if(index>=0&&existing&&previous.url!==url.href)fail('このURLはすでに登録されています',409);
  if(input.mark!==undefined)for(const b of list)if(b.url===url.href)b.mark=mark;
  if(index<0&&existing)return existing;
  const value={id:input.id||crypto.randomUUID(),title:String(input.title||url.hostname).trim().slice(0,200)||url.hostname,url:url.href,parentId,mark,createdAt:index<0?Date.now():list[index].createdAt};
  if(index<0)list.unshift(value);else list[index]=value;return value;
}
