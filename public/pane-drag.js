// Pointer capture keeps tab dragging in the workspace, including across iframe panes.
export function bindTabDrag({start,move,drop,end}){
  const bar=document.getElementById('work-tabs');let held=null,suppressClick=false;
  const point=e=>({x:e.clientX,y:e.clientY});
  bar.addEventListener('pointerdown',e=>{
    const tab=e.target.closest('[data-tab-key]');if(e.button!==0||!tab||e.target.closest('[data-close-view]'))return;
    held={tab,id:e.pointerId,origin:point(e),dragging:false};
  });
  bar.addEventListener('pointermove',e=>{
    if(!held||held.id!==e.pointerId)return;
    if(!held.dragging&&Math.hypot(e.clientX-held.origin.x,e.clientY-held.origin.y)<6)return;
    e.preventDefault();
    if(!held.dragging){held.dragging=true;held.tab.setPointerCapture(e.pointerId);start({key:held.tab.dataset.tabKey,point:point(e)});}
    move(point(e));
  });
  document.addEventListener('pointerup',e=>{
    if(!held||held.id!==e.pointerId)return;const last=held;held=null;
    if(last.dragging){e.preventDefault();suppressClick=true;setTimeout(()=>suppressClick=false,100);drop(point(e));}
    if(last.tab.hasPointerCapture(e.pointerId))last.tab.releasePointerCapture(e.pointerId);
  });
  const cancel=()=>{if(held?.dragging)end();held=null;};
  bar.addEventListener('pointercancel',cancel);bar.addEventListener('lostpointercapture',cancel);
  bar.addEventListener('dragstart',e=>e.preventDefault());
  bar.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();},true);
  window.addEventListener('blur',cancel);
}
export function setupTabDrop(deck,{targets,move,visibility,error}){
  let session=null,layer=null,zones=[],selected=null;
  function stop(){session=null;selected=null;zones=[];layer?.remove();layer=null;visibility(false);}
  function update(point){
    if(!session)return;selected=null;
    for(const {target,zone,r} of zones){
      const inside=point.x>=r.x&&point.x<=r.right&&point.y>=r.y&&point.y<=r.bottom;
      zone.classList.toggle('over',inside);zone.querySelector('.pane-drop-marker')?.remove();if(!inside)continue;
      const doc=target.document(),bar=doc?.getElementById('pane-tabbar'),offsetX=target.id==='primary'?0:r.x,offsetY=target.id==='primary'?0:r.y;
      const tabs=Array.from(doc?.querySelectorAll('#work-tabs [data-tab-key]')||[]),barRect=bar?.getBoundingClientRect();let index=tabs.length;
      const vertical=bar?.hasAttribute('data-expanded');
      if(barRect&&(vertical?point.x<barRect.right+offsetX:point.y<barRect.bottom+offsetY))index=tabs.findIndex(t=>{if(t.hidden)return false;const b=t.getBoundingClientRect();return vertical?point.y<b.y+b.height/2+offsetY:point.x<b.x+b.width/2+offsetX;});
      if(index<0)index=tabs.length;selected={target:target.id,index};
      const at=tabs[index]||tabs.at(-1);if(at){const b=at.getBoundingClientRect(),marker=document.createElement('i');marker.className='pane-drop-marker'+(vertical?' vertical':'');if(vertical){marker.style.top=Math.max(0,Math.min(r.height-4,(index===tabs.length?b.bottom:b.top)+offsetY-r.y))+'px';marker.style.width=barRect.width+'px';}else marker.style.left=Math.max(0,Math.min(r.width-4,(index===tabs.length?b.right:b.left)+offsetX-r.x))+'px';zone.append(marker);}
    }
  }
  function begin(source,data){
    stop();session={source,key:data.key};visibility(true);layer=document.createElement('div');layer.className='pane-drop-layer';deck.append(layer);
    const bounds=deck.getBoundingClientRect();
    for(const target of targets()){
      const r=target.element.getBoundingClientRect(),zone=document.createElement('div');zone.className='pane-drop-zone';zone.dataset.dropPane=target.id;
      Object.assign(zone.style,{left:(r.x-bounds.x)+'px',top:(r.y-bounds.y)+'px',width:r.width+'px',height:r.height+'px'});layer.append(zone);zones.push({target,zone,r});
    }
    if(data.point)update(data.point);
  }
  function finish(point){
    update(point);const moving=session,to=selected;stop();
    if(moving&&to)Promise.resolve(move(moving.source,to.target,moving.key,to.index)).catch(e=>error(e.message));
  }
  return {begin,update,finish,stop};
}
