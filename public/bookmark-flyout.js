import {tabIcon} from './tab-icons.js';
import {bookmarkMarks,bookmarkMark,flatBookmarks} from './bookmark-marks.js';
export function setupBookmarkFlyout({state,api,open,manage,layout,esc,error,saveCurrent}){
 const trigger=document.getElementById('rail-bookmarks'),rail=document.getElementById('pane-tabbar'),box=document.createElement('div'),picker=document.createElement('div'),saveTrigger=document.getElementById('bookmark-page');
 box.id='bookmark-flyout';box.hidden=true;box.setAttribute('aria-label','ブックマーク');picker.id='bookmark-save-palette';picker.hidden=true;picker.setAttribute('aria-label','ブックマークの登録先');document.body.append(box,picker);
 let timer,mark='star',anchor=trigger,query='';
 const triggers=[];
 const visible=()=>{rail.dispatchEvent(new CustomEvent('bookmark-visibility',{detail:!box.hidden||!picker.hidden}));layout();};
 const hide=()=>{clearTimeout(timer);box.hidden=true;picker.hidden=true;visible();};
 const leave=()=>{clearTimeout(timer);timer=setTimeout(hide,280);};
 function position(element,button){const rect=button.getBoundingClientRect();element.style.left=Math.max(8,Math.min(rect.right,innerWidth-310))+'px';element.style.top=Math.max(8,Math.min(rect.top,innerHeight-190))+'px';element.style.maxHeight=Math.max(120,innerHeight-parseFloat(element.style.top)-12)+'px';visible();}
 function refresh(){
  for(const button of triggers)button.setAttribute('aria-pressed',String(!box.hidden&&button.dataset.bookmarkMark===mark));
  if(box.hidden)return;
  const m=bookmarkMark(mark),items=flatBookmarks(state.bookmarks).filter(b=>bookmarkMark(b.mark).id===mark&&(!query||(b.title+' '+(b.url||'')).toLocaleLowerCase().includes(query)));
  box.innerHTML='<div class="bookmark-flyout-heading"><strong>'+m.symbol+' '+m.name+'</strong><button data-save-current aria-label="'+m.name+'に登録">＋ 登録</button></div><input class="bookmark-quick-search" aria-label="ブックマークを絞り込み" placeholder="検索" value="'+esc(query)+'"><div class="bookmark-column">'+(items.map(b=>'<button data-quick-bookmark="'+esc(b.id)+'" title="'+esc(b.url||b.title)+'">'+(b.kind==='task'?tabIcon({kind:'task'},state.tasks.find(t=>t.id===b.taskId),esc):tabIcon({kind:'web'},state.tabs.find(t=>t.url===b.url),esc))+'<span>'+esc(b.title)+'</span></button>').join('')||'<span class="muted small">まだありません</span>')+'</div><button class="bookmark-manage">整理・Chromeから同期</button>';
  box.querySelector('[data-save-current]').onclick=()=>{hide();saveCurrent(mark).catch(e=>error(e.message));};
  box.querySelector('.bookmark-manage').onclick=()=>{hide();manage(mark).catch(e=>error(e.message));};
  for(const button of box.querySelectorAll('[data-quick-bookmark]'))button.onclick=()=>{const b=state.bookmarks.find(x=>x.id===button.dataset.quickBookmark);hide();open(b).catch(e=>error(e.message));};
  box.querySelector('input').oninput=e=>{query=e.target.value.toLocaleLowerCase();const selection=e.target.selectionStart;refresh();const input=box.querySelector('input');input.focus();input.setSelectionRange(selection,selection);};
  position(box,anchor);
 }
 async function show(button){clearTimeout(timer);mark=button.dataset.bookmarkMark;anchor=button;query='';picker.hidden=true;box.hidden=false;refresh();try{state.bookmarks=await api('/bookmarks');refresh();}catch{}}
 for(const [index,m] of bookmarkMarks.entries()){
  const button=index===0?trigger:document.createElement('button');if(index>0)triggers.at(-1).after(button);
  button.classList.add('bookmark-category-trigger');button.dataset.bookmarkMark=m.id;button.innerHTML='<span>'+m.symbol+'</span><span class="rail-label">'+m.name+'</span>';button.setAttribute('aria-label',m.name+'のブックマーク');button.title=m.name+'のブックマーク';
  button.addEventListener('pointerenter',()=>show(button));button.addEventListener('click',()=>show(button));button.addEventListener('pointerleave',leave);triggers.push(button);
 }
 function showPicker(){clearTimeout(timer);box.hidden=true;picker.hidden=false;picker.innerHTML=bookmarkMarks.map(m=>'<button data-save-mark="'+m.id+'" title="'+m.name+'に登録" aria-label="'+m.name+'に登録">'+m.symbol+'</button>').join('');for(const b of picker.querySelectorAll('button'))b.onclick=()=>{hide();saveCurrent(b.dataset.saveMark).catch(e=>error(e.message));};position(picker,saveTrigger);}
 saveTrigger.addEventListener('pointerenter',showPicker);saveTrigger.addEventListener('pointerleave',leave);
 for(const element of [box,picker]){element.addEventListener('pointerenter',()=>clearTimeout(timer));element.addEventListener('pointerleave',leave);}
 document.addEventListener('pointerdown',e=>{if(!box.contains(e.target)&&!picker.contains(e.target)&&!saveTrigger.contains(e.target)&&!triggers.some(t=>t.contains(e.target)))hide();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});window.addEventListener('resize',hide);
 return {refresh,hide,right:()=>Math.max(box.hidden?0:box.getBoundingClientRect().right,picker.hidden?0:picker.getBoundingClientRect().right)};
}
