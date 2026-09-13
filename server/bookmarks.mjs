import crypto from 'node:crypto';
import {fail} from './files.mjs';
export function editBookmark(list,input){
  const index=input.id?list.findIndex(b=>b.id===input.id):-1;
  if(input.id&&index<0)fail('ブックマークが見つかりません',404);
  if(input.remove){if(index<0)fail('ブックマークを選んでください');list.splice(index,1);return;}
  let url;try{url=new URL(input.url);}catch{fail('URLを確認してください');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>8000)fail('http / https のページを指定してください');
  const existing=list.find(b=>b.url===url.href&&b.id!==input.id);
  if(index>=0&&existing)fail('このURLはすでに登録されています',409);
  if(index<0&&existing)return existing;
  const value={id:input.id||crypto.randomUUID(),title:String(input.title||url.hostname).trim().slice(0,200)||url.hostname,url:url.href,createdAt:index<0?Date.now():list[index].createdAt};
  if(index<0)list.unshift(value);else list[index]=value;return value;
}
