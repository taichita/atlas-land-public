// Called only by the native host. No credentials, input values or HTML are collected.
(mode,payload)=>{
  const key='__atlasPageTranslation';
  if(!window[key]){
    const state={documentId:Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-'),entries:new Map(),serial:0,auto:false,timer:null};
    window[key]=state;
    const observer=new MutationObserver(()=>{if(!state.auto)return;clearTimeout(state.timer);state.timer=setTimeout(()=>window.chrome?.webview?.postMessage({type:'atlas.translation.dirty'}),1500);});
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }
  const state=window[key];
  if(mode==='auto'){state.auto=!!payload;return true;}
  if(mode==='restore'){
    state.auto=false;clearTimeout(state.timer);
    for(const entry of state.entries.values())if(entry.node.isConnected&&entry.node.nodeValue===entry.translated)entry.node.nodeValue=entry.original;
    state.entries.clear();return true;
  }
  if(mode==='apply'){
    if(payload.documentId!==state.documentId||payload.url!==location.href)return {stale:true};
    let count=0;
    for(const item of payload.items){const entry=state.entries.get(item.id);if(!entry||!entry.node.isConnected||entry.node.nodeValue!==entry.original||typeof item.text!=='string')continue;
      entry.translated=entry.original.replace(entry.original.trim(),item.text);entry.node.nodeValue=entry.translated;count++;
    }
    return {count};
  }
  const skip='script,style,noscript,textarea,input,select,code,pre,kbd,samp,svg,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"]';
  const known=new Map();
  for(const [id,entry] of state.entries){if(!entry.node.isConnected){state.entries.delete(id);continue;}known.set(entry.node,id);}
  const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_TEXT),items=[];
  let node,total=0;
  while((node=walker.nextNode())){
    const parent=node.parentElement,raw=node.nodeValue,text=raw.trim();
    if(!parent||parent.closest(skip)||!/[a-zA-Z]{2}/.test(text)||text.length>3000||/[\u3040-\u30ff]/.test(text)||/[A-Za-z0-9_\-]{28,}/.test(text)||/\b(?:Bearer|sk-|ghp_|AKIA)\S+/i.test(text))continue;
    const style=getComputedStyle(parent);if(style.visibility==='hidden'||style.display==='none'||!parent.getClientRects().length)continue;
    const priorId=known.get(node),prior=state.entries.get(priorId);if(prior?.translated===raw)continue;
    if(total+text.length>20000||items.length>=180)break;
    if(priorId)state.entries.delete(priorId);
    const id=String(++state.serial);state.entries.set(id,{node,original:raw});items.push({id,text});total+=text.length;
  }
  return {documentId:state.documentId,url:location.href,items};
}
