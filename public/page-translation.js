import {googleTranslationURL} from './translation-url.js';
export function setupPageTranslation({host,api,state,save,toast,openWeb}){
  const $=id=>document.getElementById(id),jobs=new Map(),counts=new Map(),translated=new Set(),muted=new Set(),again=new Set();
  const origin=id=>{try{return new URL(state.tabs.find(t=>t.id===id)?.url).origin;}catch{return null;}};
  const provider=()=>state.ui.translationProvider==='codex'?'codex':'google';
  const enabled=id=>provider()==='codex'&&!!origin(id)&&(state.ui.translationOrigins||[]).includes(origin(id));
  const message=(id,text)=>{if(state.activeTab===id)$('browser-message').textContent=text;};
  function render(){const id=state.activeTab;$('translate-provider').value=provider();$('translate-auto').disabled=provider()!=='codex';$('translate-auto').checked=enabled(id);$('translate-page').title=provider()==='google'?'Google翻訳で公開ページを別タブに表示':'Codexでこのページ内を翻訳';$('translate-page').disabled=!id||jobs.has(id);$('translate-page').textContent=jobs.has(id)?'翻訳中…':'日本語訳';$('translate-original').hidden=!translated.has(id)&&!jobs.has(id);}
  async function translate(id=state.activeTab,automatic=false){
    if(!id||jobs.has(id)||automatic&&(!enabled(id)||muted.has(id)||counts.get(id)>=10))return;
    if(provider()==='google'){
      if(automatic)return;
      try{await openWeb(googleTranslationURL(state.tabs.find(t=>t.id===id)?.url));}catch(e){toast(e.message);}return;
    }
    const job={};jobs.set(id,job);render();
    try{
      await host('browser.translation',{id,mode:'auto',payload:enabled(id)});
      const snapshot=await host('browser.translation',{id,mode:'collect'});
      if(automatic&&!(state.ui.translationOrigins||[]).includes(new URL(snapshot.url).origin))return;
      if(!snapshot?.items?.length){message(id,'');return;}
      counts.set(id,(counts.get(id)||0)+1);message(id,'Codexで翻訳中…');
      const result=await api('/translate',{texts:snapshot.items.map(x=>x.text)});
      if(job.cancelled)return;
      const applied=await host('browser.translation',{id,mode:'apply',payload:{...snapshot,items:snapshot.items.map((x,i)=>({id:x.id,text:result.translations[i]}))}});
      if(!applied?.stale){translated.add(id);message(id,'日本語訳 · Codex');}
    }catch(e){muted.add(id);message(id,e.message);if(!automatic)toast(e.message);}
    finally{jobs.delete(id);render();if(again.delete(id))translate(id,true);}
  }
  $('translate-page').onclick=()=>{muted.delete(state.activeTab);translate();};
  $('translate-provider').onchange=()=>{
    state.ui.translationProvider=$('translate-provider').value;save();again.clear();
    for(const job of jobs.values())job.cancelled=true;
    for(const tab of state.tabs)host('browser.translation',{id:tab.id,mode:'auto',payload:enabled(tab.id)}).catch(()=>{});
    render();
  };
  $('translate-auto').onchange=()=>{
    const id=state.activeTab,site=origin(id);if(!site)return;
    const origins=new Set(state.ui.translationOrigins||[]);if($('translate-auto').checked)origins.add(site);else origins.delete(site);
    state.ui.translationOrigins=[...origins];save();muted.delete(id);counts.set(id,0);
    if(!enabled(id)&&jobs.has(id))jobs.get(id).cancelled=true;
    host('browser.translation',{id,mode:'auto',payload:enabled(id)}).catch(e=>toast(e.message));if(enabled(id))translate(id,true);
  };
  $('translate-original').onclick=async()=>{
    const id=state.activeTab;if(jobs.has(id))jobs.get(id).cancelled=true;muted.add(id);
    try{await host('browser.translation',{id,mode:'restore'});translated.delete(id);message(id,'原文');render();}catch(e){toast(e.message);}
  };
  function event(m){
    if(m.type==='browser.translate-request'){muted.delete(m.id);translate(m.id);}
    if(m.type==='browser.translation-ready'){const tab=state.tabs.find(t=>t.id===m.id);if(tab&&m.url)tab.url=m.url;counts.delete(m.id);translated.delete(m.id);muted.delete(m.id);render();if(enabled(m.id)){if(jobs.has(m.id)){jobs.get(m.id).cancelled=true;again.add(m.id);}else translate(m.id,true);}}
    if(m.type==='browser.translation-dirty'&&enabled(m.id)){if(jobs.has(m.id))again.add(m.id);else translate(m.id,true);}
  }
  return {render,event};
}
