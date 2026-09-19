import {svgIcon,tabIcon} from './tab-icons.js';
export function setupBookmarkFlyout({state,api,open,manage,layout,esc,error}){
  const trigger=document.getElementById('rail-bookmarks'),box=document.createElement('div');box.id='bookmark-flyout';box.hidden=true;box.setAttribute('aria-label','ブックマーク');document.body.append(box);
  let timer,path=[];
  const rail=document.getElementById('pane-tabbar');
  const hide=()=>{clearTimeout(timer);box.hidden=true;rail.dispatchEvent(new CustomEvent('bookmark-visibility',{detail:false}));layout();};
  function refresh(){
    if(box.hidden)return;
    const all=state.bookmarks||[],parents=[null,...path];box.replaceChildren();
    parents.forEach((parent,level)=>{
      const column=document.createElement('div');column.className='bookmark-column';
      const items=all.filter(b=>(b.parentId||null)===parent);
      for(const b of items){
        const button=document.createElement('button');button.dataset.quickBookmark=b.id;button.title=b.url||b.title;
        button.innerHTML=(b.kind==='folder'?svgIcon('folder'):b.kind==='task'?tabIcon({kind:'task'},state.tasks.find(t=>t.id===b.taskId),esc):tabIcon({kind:'web'},state.tabs.find(t=>t.url===b.url),esc))+`<span>${esc(b.title)}</span>${b.kind==='folder'?'<small>›</small>':''}`;
        button.setAttribute('aria-label',b.title);if(b.kind==='folder')button.setAttribute('aria-haspopup','true');
        const browse=()=>{const next=path.slice(0,level);if(b.kind==='folder')next.push(b.id);if(JSON.stringify(next)!==JSON.stringify(path)){path=next;refresh();}};
        button.onpointerenter=browse;
        button.onclick=()=>{if(b.kind==='folder'){browse();box.children[level+1]?.querySelector('button')?.focus();}else{hide();open(b).catch(e=>error(e.message));}};
        column.append(button);
      }
      if(!items.length){const empty=document.createElement('span');empty.className='muted small';empty.textContent='まだありません';column.append(empty);}
      if(level===0){const button=document.createElement('button');button.textContent='整理・Chromeから同期';button.className='bookmark-manage';button.onclick=()=>{hide();manage();};column.append(button);}
      box.append(column);
    });
    const anchor=trigger.getBoundingClientRect();box.style.left=Math.min(anchor.right,Math.max(0,innerWidth-240))+'px';box.style.top=Math.min(anchor.top,innerHeight-180)+'px';box.style.maxWidth=Math.max(180,innerWidth-parseFloat(box.style.left)-12)+'px';box.style.maxHeight=Math.max(120,innerHeight-parseFloat(box.style.top)-12)+'px';layout();
  }
  async function show(){clearTimeout(timer);path=[];rail.dispatchEvent(new CustomEvent('bookmark-visibility',{detail:true}));box.hidden=false;refresh();try{state.bookmarks=await api('/bookmarks');refresh();}catch{}}
  trigger.addEventListener('pointerenter',show);trigger.addEventListener('click',show);
  const leave=()=>{clearTimeout(timer);timer=setTimeout(hide,260);};
  trigger.addEventListener('pointerleave',leave);box.addEventListener('pointerenter',()=>clearTimeout(timer));box.addEventListener('pointerleave',leave);
  document.addEventListener('pointerdown',e=>{if(!box.contains(e.target)&&!trigger.contains(e.target))hide();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});window.addEventListener('resize',hide);
  return {refresh,hide,right:()=>box.hidden?0:box.getBoundingClientRect().right};
}
