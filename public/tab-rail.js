export function setupTabRail(layout) {
  const rail=document.getElementById('pane-tabbar'),toggle=document.getElementById('tab-rail-toggle'),search=document.getElementById('tab-search'),tabs=document.getElementById('work-tabs');
  let timer,hovered=false,keyboard=false,bookmarks=false;
  function expand(value){clearTimeout(timer);rail.dataset.expanded=String(value);toggle.setAttribute('aria-expanded',String(value));toggle.setAttribute('aria-label',value?'タブ一覧を閉じる':'タブ一覧を開く');if(!value){search.value='';refresh();}layout();}
  function refresh(){
    const query=search.value.trim().toLocaleLowerCase(),items=[...tabs.querySelectorAll('[data-tab-key]')];
    for(const item of items)item.hidden=!!query&&!item.dataset.tabTitle.toLocaleLowerCase().includes(query);
    document.getElementById('tab-count').textContent=String(items.length);
  }
  rail.addEventListener('pointerenter',()=>{hovered=true;clearTimeout(timer);timer=setTimeout(()=>expand(true),100);});
  rail.addEventListener('pointerleave',()=>{hovered=false;clearTimeout(timer);timer=setTimeout(()=>{if(!keyboard&&!bookmarks){if(rail.contains(document.activeElement))document.activeElement.blur();expand(false);}},220);});
  rail.addEventListener('bookmark-visibility',e=>{bookmarks=e.detail;if(bookmarks)expand(true);else if(!hovered&&!keyboard)expand(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Tab')keyboard=true;},true);
  document.addEventListener('pointerdown',()=>keyboard=false,true);
  rail.addEventListener('focusin',()=>{if(keyboard)expand(true);});
  rail.addEventListener('focusout',()=>queueMicrotask(()=>{if(!hovered&&!bookmarks&&!rail.contains(document.activeElement))expand(false);}));
  rail.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();search.value='';refresh();document.activeElement?.blur();expand(false);}});
  toggle.addEventListener('click',()=>expand(rail.dataset.expanded!=='true'));
  search.addEventListener('input',refresh);
  new ResizeObserver(layout).observe(rail);
  return {refresh};
}
