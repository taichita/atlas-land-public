import {setupPaneResize} from './pane-resize.js';
import {bindTabDrag,setupTabDrop} from './pane-drag.js';
export const paneMode = window.parent !== window && new URLSearchParams(location.search).has('pane');
const channel = 'atlas-pane-v1';
export const paneBridge = paneMode ? {
  postMessage(message) { parent.postMessage({channel,type:'native',message},location.origin); },
  addEventListener(_,callback) { window.addEventListener('message',e=>{
    if(e.source===parent&&e.origin===location.origin&&e.data?.channel===channel&&e.data.type==='native')callback({data:e.data.message});
  }); },
} : window.chrome?.webview;

export function setupPanes(api) {
  const $=id=>document.getElementById(id);
  // Each pane owns its tabs; editor drafts are shared between panes.
  if(paneMode) {
    document.body.classList.add('pane-embedded');
    let initialized=false;
    const send=data=>parent.postMessage({channel,...data},location.origin);
    const publish=()=>{if(initialized)send({type:'snapshot',snapshot:api.snapshot()});};
    bindTabDrag({start:data=>send({type:'tab-drag',...data}),move:point=>send({type:'tab-drag-move',point}),drop:point=>send({type:'tab-drop',point}),end:()=>send({type:'tab-drag-end'})});
    window.addEventListener('message',async e=>{
      if(e.source!==parent||e.origin!==location.origin||e.data?.channel!==channel)return;
      const m=e.data;
      try {
        if(m.type==='restore'){initialized=false;await api.restore(m.snapshot);initialized=true;publish();}
        else if(m.type==='open'){await api.open(m.view);publish();}
        else if(m.type==='flush'){await api.save();publish();}
        else if(m.type==='place'){api.place(m.key,m.index);publish();}
        else if(m.type==='focus')await api.focus();
        else if(m.type==='layout')api.layout();
        else if(m.type==='visibility')api.visibility(m.visible);
        else return;
        if(m.id)send({type:'reply',id:m.id,snapshot:api.snapshot()});
      }catch(error){send({type:'reply',id:m.id,error:error.message});}
    });
    const focus=()=>send({type:'focused'});
    document.addEventListener('pointerdown',focus,true);document.addEventListener('focusin',focus,true);
    return {
      ready(){send({type:'ready'});},changed:publish,persist(){publish();send({type:'drafts',drafts:api.drafts()});},
      shortcut(command){send({type:'shortcut',command});},toggle(){send({type:'shortcut',command:'split'});},
      focus(side){send({type:'shortcut',command:side==='right'?'focus-right':'focus-left'});},
      closePane(){send({type:'shortcut',command:'close-pane'});},moveCurrent(){send({type:'shortcut',command:'move-pane'});},
      post:m=>paneBridge?.postMessage(m),render(){},save:()=>api.save(),selected:()=>null,
    };
  }
  const deck=$('workspace-deck'),primary=$('primary-slot');
  $('workspace-divider').remove();
  $('secondary-slot').remove();
  const panes=new Map(),pending=new Map();
  let active='primary',zoomed=null,primaryLayout={},layout='auto',ratio=50,restoring=false,serial=0;
  const send=(p,data)=>p.frame.contentWindow?.postMessage({channel,...data},location.origin);
  const rpc=(p,type,data={})=>new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('ペインの応答がありません'));},15000);
    pending.set(id,{pane:p.id,resolve,reject,timer});send(p,{type,...data,id});
  });
  const current=p=>p?.snapshot?.views?.find(v=>v.key===p.snapshot.activeView);
  const compact=()=>({version:1,layout,ratio,sizes:resize.snapshot(),panes:[...panes.values()].map(p=>({id:p.id,snapshot:p.snapshot}))});
  const resize=setupPaneResize(deck,{change:remember,layout:relayout,drag(value){deck.classList.toggle('dragging',value);flushLayout();}});
  const drop=setupTabDrop(deck,{targets:()=>[{id:'primary',element:primary,document:()=>document},...[...panes.values()].map(p=>({id:p.id,element:p.frame,document:()=>p.frame.contentDocument}))],move:transfer,error:api.error,visibility(value){deck.classList.toggle('dragging',value);flushLayout();if(!value)relayout();}});
  bindTabDrag({start:data=>drop.begin('primary',data),move:point=>drop.update(point),drop:point=>drop.finish(point),end:()=>drop.stop()});
  function remember(){if(!restoring)api.rememberLayout(compact());}
  function flushLayout(){
    const hidden=$('work-view').hidden||$('dialog').open||deck.classList.contains('dragging');
    const all=hidden||zoomed&&zoomed!=='primary'?[]:[...(primaryLayout.visible?primaryLayout.panes||[]:[])];
    if(!hidden)for(const p of panes.values()){
      if(zoomed&&zoomed!==p.id)continue;
      const r=p.frame.getBoundingClientRect();
      if(p.browserLayout?.visible)for(const b of p.browserLayout.panes||[])all.push({...b,id:p.id+':'+b.id,x:b.x+r.x,y:b.y+r.y});
    }
    paneBridge?.postMessage({action:'browser.layout',visible:all.length>0,panes:all,viewportWidth:innerWidth});
  }
  function render(){
    const count=panes.size+1,{columns}=resize.render(layout,count);
    deck.classList.toggle('is-split',count>1);
    deck.classList.toggle('pane-zoomed',!!zoomed);
    for(const [id,slot] of [['primary',primary],...[...panes.values()].map(p=>[p.id,p.slot])]){
      slot.classList.toggle('pane-zoom-target',zoomed===id);
      slot.classList.toggle('pane-zoom-hidden',!!zoomed&&zoomed!==id);
      slot.inert=!!zoomed&&zoomed!==id;
    }
    primary.style.gridColumn='1';primary.style.gridRow='1';
    let i=0;for(const p of panes.values()){i++;p.slot.style.gridColumn=String(i%columns+1);p.slot.style.gridRow=String(Math.floor(i/columns)+1);p.frame.title='ペイン '+(i+1);p.slot.classList.toggle('focused',active===p.id);}
    primary.classList.toggle('focused',active==='primary');$('pane-close').disabled=!panes.size;$('pane-swap').hidden=!panes.size;$('pane-layout').value=layout;flushLayout();
  }
  function relayout(){api.layout();for(const p of panes.values())send(p,{type:'layout'});flushLayout();resize.position();}
  async function mount(snapshot,id){
    id=id&&/^[a-z0-9-]+$/i.test(id)&&id!=='primary'&&!panes.has(id)?id:'pane-'+crypto.randomUUID();
    const slot=document.createElement('section');slot.className='extra-pane';slot.dataset.pane=id;
    const frame=document.createElement('iframe');frame.className='pane-frame';frame.id=serial++===0?'secondary-frame':'frame-'+id;
    let resolveReady;const ready=new Promise(resolve=>resolveReady=resolve);
    const p={id,slot,frame,snapshot:snapshot||{views:[],tabs:[],activeView:null},ready:false,resolveReady,readyPromise:ready};
    panes.set(id,p);slot.append(frame);deck.append(slot);render();frame.src='/?pane='+encodeURIComponent(id)+'#'+encodeURIComponent(api.token);
    try{await Promise.race([ready,new Promise((_,reject)=>{p.readyTimer=setTimeout(()=>reject(new Error('ペインを読み込めませんでした')),20000);})]);}finally{clearTimeout(p.readyTimer);}
    remember();return p;
  }
  async function add(view){
    zoomed=null;
    if(!view)view=active==='primary'?api.describe(api.current()):current(panes.get(active));
    const p=await mount(view?{views:[view],tabs:view.tab?[view.tab]:[],activeView:view.key}:null);
    active=p.id;render();remember();await focusId(p.id);
  }
  async function focusId(id){
    active=panes.has(id)?id:'primary';if(zoomed)zoomed=active;render();relayout();if(active==='primary')return api.focus();
    const p=panes.get(active);paneBridge?.postMessage({action:'window.focusUI'});p.frame.focus();if(p.ready)await rpc(p,'focus');
  }
  async function focus(side){const ids=['primary',...panes.keys()],i=ids.indexOf(active);await focusId(ids[(i+(side==='right'?1:-1)+ids.length)%ids.length]);}
  async function closePane(){
    zoomed=null;
    if(active==='primary'&&panes.size){await swap();active=panes.keys().next().value;}
    const p=panes.get(active);if(!p)return;if(p.ready)await rpc(p,'flush');
    for(const t of p.snapshot?.tabs||[])paneBridge?.postMessage({action:'browser.close',id:p.id+':'+t.id});
    for(const [id,wait] of pending)if(wait.pane===p.id){clearTimeout(wait.timer);pending.delete(id);wait.reject(new Error('ペインを閉じました'));}
    clearTimeout(p.readyTimer);p.slot.remove();panes.delete(p.id);active='primary';remember();render();relayout();await api.focus();
  }
  async function swap(){
    const p=panes.get(active)||panes.values().next().value;if(!p)return;
    await rpc(p,'flush');await api.save();const old=api.snapshot();await api.restore(p.snapshot);await rpc(p,'restore',{snapshot:old});remember();relayout();
  }
  async function transfer(sourceId,target,key,index=null){
    const source=sourceId==='primary'?null:panes.get(sourceId);if(sourceId!=='primary'&&!source||target!=='primary'&&!panes.has(target))return;
    if(source)await rpc(source,'flush');else await api.save();
    const snapshot=source?source.snapshot:api.snapshot(),view=snapshot.views.find(v=>v.key===key);if(!view)return;
    if(sourceId===target){const old=snapshot.views.findIndex(v=>v.key===key);index=index??snapshot.views.length;if(old<index)index--;if(source)await rpc(source,'place',{key,index});else api.place(key,index);remember();return;}
    if(target==='primary'){await api.open(view);if(index!==null)api.place(key,index);}else{await rpc(panes.get(target),'open',{view});if(index!==null)await rpc(panes.get(target),'place',{key,index});}
    if(source)await rpc(source,'restore',{snapshot:{...source.snapshot,views:source.snapshot.views.filter(v=>v.key!==view.key),tabs:source.snapshot.tabs.filter(t=>t.id!==view.id),activeView:source.snapshot.views.find(v=>v.key!==view.key)?.key||null}});
    else await api.close(view.key);
    await focusId(target);remember();
  }
  async function moveCurrent(){
    const ids=['primary',...panes.keys()];if(ids.length===1){await add();return;}
    const view=active==='primary'?api.current():current(panes.get(active));if(view)await transfer(active,ids[(ids.indexOf(active)+1)%ids.length],view.key);
  }
  async function command(name){
    if(name==='zoom-pane')return zoom();
    if(name==='split')return add();if(name==='close-pane')return closePane();if(name==='move-pane')return moveCurrent();
    if(name==='focus-left'||name==='focus-right')return focus(name==='focus-right'?'right':'left');return api.shortcut(name);
  }
  async function zoom(){if(!panes.size)return;zoomed=zoomed?null:active;render();relayout();await focusId(active);}
  window.addEventListener('message',async e=>{
    if(e.origin!==location.origin||e.data?.channel!==channel)return;
    const p=[...panes.values()].find(p=>e.source===p.frame.contentWindow);if(!p)return;const m=e.data;
    try{
      if(m.type==='ready'){await rpc(p,'restore',{snapshot:p.snapshot});p.ready=true;p.resolveReady();relayout();}
      else if(m.type==='reply'){const wait=pending.get(m.id);if(wait&&wait.pane===p.id){clearTimeout(wait.timer);pending.delete(m.id);if(m.snapshot)p.snapshot=m.snapshot;m.error?wait.reject(new Error(m.error)):wait.resolve();}}
      else if(m.type==='snapshot'){p.snapshot=m.snapshot;remember();}
      else if(m.type==='focused'){active=p.id;render();}
      else if(m.type==='tab-drag'){if(p.snapshot.views.some(v=>v.key===m.key)){const r=p.frame.getBoundingClientRect();drop.begin(p.id,{key:m.key,point:{x:m.point.x+r.x,y:m.point.y+r.y}});}}
      else if(m.type==='tab-drag-move'||m.type==='tab-drop'){const r=p.frame.getBoundingClientRect(),point={x:m.point.x+r.x,y:m.point.y+r.y};if(m.type==='tab-drop')drop.finish(point);else drop.update(point);}
      else if(m.type==='tab-drag-end')drop.stop();
      else if(m.type==='drafts')api.mergeDrafts(m.drafts);
      else if(m.type==='shortcut'){active=p.id;await command(m.command);}
      else if(m.type==='native'){
        const n={...m.message};if(n.action==='browser.layout'){p.browserLayout=n;flushLayout();return;}
        if(['activity','app.exit','browser.mediaKeys','window.shortcuts'].includes(n.action))return;
        if(n.id)n.id=p.id+':'+n.id;if(n.requestId)n.requestId=p.id+':'+n.requestId;paneBridge?.postMessage(n);
      }
    }catch(error){api.error(error.message);}
  });
  primary.addEventListener('pointerdown',()=>{active='primary';render();},true);primary.addEventListener('focusin',()=>{active='primary';render();},true);
  $('pane-split').onclick=()=>add().catch(e=>api.error(e.message));$('pane-close').onclick=()=>closePane().catch(e=>api.error(e.message));
  $('pane-move').onclick=()=>moveCurrent().catch(e=>api.error(e.message));$('pane-swap').onclick=()=>swap().catch(e=>api.error(e.message));
  $('pane-layout').onchange=e=>{layout=e.target.value;render();remember();relayout();};
  new ResizeObserver(relayout).observe(deck);render();
  return {
    toggle:add,choose:add,zoom,focus,swap,closePane,moveCurrent,render,selected:()=>null,close:async()=>{},
    async twoPanes(){
      if(!panes.size)await mount({views:[],tabs:[],activeView:null});
      await Promise.all([...panes.values()].map(p=>Promise.race([p.readyPromise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('ペインの起動を待っています')),20000))])));
      const target=panes.keys().next().value;
      // Preserve all open tabs while folding extra panes into the companion.
      for(const p of [...panes.values()].slice(1)){
        await rpc(p,'flush');
        for(const view of [...p.snapshot.views])await transfer(p.id,target,view.key);
        active=p.id;await closePane();
      }
      layout='columns';resize.restore({},50);active='primary';render();remember();relayout();
    },
    async restore(saved,legacy){
      restoring=true;try{
        if(saved?.version===1){layout=['auto','rows','columns'].includes(saved.layout)?saved.layout:'auto';ratio=Number.isFinite(saved.ratio)?Math.min(80,Math.max(20,saved.ratio)):50;resize.restore(saved.sizes,ratio);for(const p of saved.panes||[])await mount(p.snapshot,p.id);}
        else if(legacy){const view=api.describe(legacy);await mount({views:[view],tabs:view.tab?[view.tab]:[],activeView:view.key});}
      }finally{restoring=false;active='primary';render();remember();relayout();}
    },
    async save(){await Promise.all([...panes.values()].filter(p=>p.ready).map(p=>rpc(p,'flush')));remember();},changed:render,
    post(m){if(m.action==='browser.layout'){primaryLayout=m;flushLayout();}else paneBridge?.postMessage(m);},
    route(m){
      const p=[...panes.values()].find(p=>m.id?.startsWith(p.id+':')||m.requestId?.startsWith(p.id+':'));
      if(p){if(m.type==='shortcut'||m.type==='browser.focused'){active=p.id;render();}const prefix=p.id.length+1;send(p,{type:'native',message:{...m,...(m.id?{id:m.id.slice(prefix)}:{}),...(m.requestId?{requestId:m.requestId.slice(prefix)}:{})}});return true;}
      if(m.type==='browser.focused'){active='primary';render();return true;}
      if(m.type==='shortcut'){const focused=[...panes.values()].find(p=>document.activeElement===p.frame);if(focused&&!m.id){active=focused.id;send(focused,{type:'native',message:m});return true;}if(m.id)active='primary';}
      return false;
    },
  };
}
