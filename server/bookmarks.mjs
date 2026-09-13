import crypto from 'node:crypto';
import {fail} from './files.mjs';
export function editBookmark(list,input){
  const index=input.id?list.findIndex(b=>b.id===input.id):-1;
  if(input.id&&index<0)fail('ブックマークが見つかりません',404);
  if(input.remove){if(index<0)fail('ブックマークを選んでください');if(list.some(b=>b.parentId===input.id))fail('中の項目を移動してから削除してください');list.splice(index,1);return;}
  const previous=index<0?null:list[index],kind=previous?.kind||input.kind||'bookmark';
  const parentId=input.parentId===undefined?(previous?.parentId||null):(input.parentId||null);
  if(parentId&&!list.some(b=>b.id===parentId&&b.kind==='folder'))fail('保存先フォルダーが見つかりません');
  let ancestor=parentId;const seen=new Set();
  while(ancestor){if(ancestor===input.id||seen.has(ancestor))fail('このフォルダーには移動できません');seen.add(ancestor);ancestor=list.find(b=>b.id===ancestor)?.parentId;}
  if(kind==='folder'){
    const title=String(input.title||'').trim().slice(0,200);if(!title)fail('フォルダー名を入力してください');
    const value={id:input.id||crypto.randomUUID(),kind,title,parentId,createdAt:previous?.createdAt||Date.now()};
    if(index<0)list.unshift(value);else list[index]=value;return value;
  }
  let url;try{url=new URL(input.url);}catch{fail('URLを確認してください');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>8000)fail('http / https のページを指定してください');
  const existing=list.find(b=>b.url===url.href&&b.id!==input.id);
  if(index>=0&&existing)fail('このURLはすでに登録されています',409);
  if(index<0&&existing)return existing;
  const value={id:input.id||crypto.randomUUID(),title:String(input.title||url.hostname).trim().slice(0,200)||url.hostname,url:url.href,parentId,createdAt:index<0?Date.now():list[index].createdAt};
  if(index<0)list.unshift(value);else list[index]=value;return value;
}
