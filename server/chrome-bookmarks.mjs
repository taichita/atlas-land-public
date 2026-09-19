import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const idFor=value=>'chrome-'+crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
export function chromeTree(document,profile){
  const items=[],root=idFor(profile);
  items.push({id:root,kind:'folder',title:profile==='Default'?'Chrome':'Chrome · '+profile,parentId:null,source:'chrome'});
  const visit=(node,parent,trail)=>{
    if(!node||typeof node!=='object')return;
    const id=idFor(profile+'/'+(node.id||trail));
    if(node.type==='folder'||Array.isArray(node.children)){
      items.push({id,kind:'folder',title:String(node.name||'フォルダ').slice(0,200),parentId:parent,source:'chrome'});
      (node.children||[]).forEach((child,i)=>visit(child,id,trail+'/'+i));
    }else if(node.type==='url'){
      let url;try{url=new URL(node.url);}catch{return;}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;
      items.push({id,title:String(node.name||url.hostname).slice(0,200),url:url.href,parentId:parent,source:'chrome'});
    }
  };
  for(const [key,node] of Object.entries(document.roots||{}))visit(node,root,key);
  return items;
}
export function mergeChromeBookmarks(existing,incoming,profileIds){
  const roots=new Set(profileIds),old=new Map(existing.map(b=>[b.id,b]));
  const fromProfile=b=>roots.has(b.chromeProfile);
  return [...existing.filter(b=>b.source!=='chrome'||!fromProfile(b)||b.chromeEdited),...incoming.filter(b=>!old.get(b.id)?.chromeEdited).map(b=>({...old.get(b.id),...b,createdAt:old.get(b.id)?.createdAt||Date.now()}))];
}
export class ChromeBookmarks {
  constructor(store,{root=path.join(process.env.LOCALAPPDATA||'','Google/Chrome/User Data')}={}){this.store=store;this.root=root;this.lastRead=0;}
  async sync(force=false){
    if(this.pending)return this.pending;
    if(!force&&Date.now()-this.lastRead<30000)return {changed:false};
    this.pending=this.read().finally(()=>this.pending=null);return this.pending;
  }
  async read(){
    this.lastRead=Date.now();const names=await fs.readdir(this.root).catch(()=>[]),incoming=[],profiles=[],errors=[];
    for(const profile of names.filter(n=>n==='Default'||/^Profile \d+$/.test(n))){
      try{
        const file=path.join(this.root,profile,'Bookmarks'),stat=await fs.stat(file);if(stat.size>20*1024*1024)throw Error('too large');
        const doc=JSON.parse(await fs.readFile(file,'utf8'));if(!doc.roots)throw Error('no roots');
        profiles.push(profile);incoming.push(...chromeTree(doc,profile).map(b=>({...b,chromeProfile:profile})));
      }catch(e){if(e.code!=='ENOENT')errors.push(profile);}
    }
    const ignored=new Set(this.store.data.chromeBookmarkHidden||[]);
    const byId=new Map(incoming.map(b=>[b.id,b]));
    const hidden=b=>{const seen=new Set();let current=b;while(current&&!seen.has(current.id)){if(ignored.has(current.id))return true;seen.add(current.id);current=byId.get(current.parentId);}return false;};
    const before=this.store.data.bookmarks||[],after=mergeChromeBookmarks(before,incoming.filter(b=>!hidden(b)),profiles),changed=JSON.stringify(before)!==JSON.stringify(after);
    if(changed){this.store.data.bookmarks=after;this.store.flush();}
    return {changed,profiles:profiles.length,count:incoming.filter(b=>b.kind!=='folder').length,errors};
  }
}
