// Resize grid tracks without moving iframe elements (moving them reloads pages).
export function setupPaneResize(deck,{change,layout,drag}){
  let sizes={},key='',columns=1,rows=1,handles=[],current=null,frame=0;
  const weights=axis=>sizes[key][axis];
  const usable=axis=>Math.max(1,(axis==='columns'?deck.clientWidth:deck.clientHeight)-8*(weights(axis).length-1));
  function end(){if(!current)return;current=null;drag(false);layout();}
  function adjust(axis,index,delta,initial){
    const values=weights(axis),base=initial||values.slice(),sum=base.reduce((a,b)=>a+b,0),pair=base[index]+base[index+1];
    const unit=usable(axis)/sum,min=Math.min(40/unit,pair/4);
    values[index]=Math.max(min,Math.min(pair-min,base[index]+delta/unit));values[index+1]=pair-values[index];
    apply();change();layout();
  }
  function position(){
    cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      for(const h of handles){const axis=h.dataset.axis,index=Number(h.dataset.index),v=weights(axis),sum=v.reduce((a,b)=>a+b,0),offset=usable(axis)*v.slice(0,index+1).reduce((a,b)=>a+b,0)/sum+8*index;
        h.style[axis==='columns'?'left':'top']=offset+'px';
        h.setAttribute('aria-valuenow',Math.round(v[index]/(v[index]+v[index+1])*100));
      }
    });
  }
  function apply(){
    deck.style.gridTemplateColumns=weights('columns').map(v=>`minmax(0,${v}fr)`).join(' ');
    deck.style.gridTemplateRows=weights('rows').map(v=>`minmax(0,${v}fr)`).join(' ');position();
  }
  return {
    snapshot:()=>sizes,
    restore(value,ratio=50){sizes={};for(const [k,v] of Object.entries(value||{}))if(v&&['rows','columns'].every(a=>Array.isArray(v[a])&&v[a].length&&v[a].every(n=>Number.isFinite(n)&&n>0)))sizes[k]={rows:[...v.rows],columns:[...v.columns]};if(!sizes['auto:2:1'])sizes['auto:2:1']={columns:[ratio,100-ratio],rows:[1]};key='';},
    render(mode,count){
      columns=mode==='rows'?1:mode==='columns'?count:Math.ceil(Math.sqrt(count));rows=Math.ceil(count/columns);
      const next=mode+':'+columns+':'+rows;
      if(next!==key){
        end();key=next;
        if(!sizes[key]||sizes[key].columns.length!==columns||sizes[key].rows.length!==rows)sizes[key]={columns:Array(columns).fill(1),rows:Array(rows).fill(1)};
        handles.forEach(h=>h.remove());handles=[];
        for(const axis of ['columns','rows'])for(let i=0;i<weights(axis).length-1;i++){
          const h=document.createElement('div');h.className='pane-resizer';h.dataset.axis=axis;h.dataset.index=i;h.tabIndex=0;h.setAttribute('role','separator');h.setAttribute('aria-orientation',axis==='columns'?'vertical':'horizontal');h.setAttribute('aria-label',(axis==='columns'?'列の幅':'行の高さ')+' '+(i+1));h.setAttribute('aria-valuemin','0');h.setAttribute('aria-valuemax','100');
          if(!handles.length)h.id='workspace-divider';
          h.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();h.setPointerCapture(e.pointerId);current={h,axis,index:i,start:axis==='columns'?e.clientX:e.clientY,base:weights(axis).slice()};drag(true);};
          h.onpointermove=e=>{if(current?.h!==h)return;adjust(axis,i,(axis==='columns'?e.clientX:e.clientY)-current.start,current.base);};
          h.onpointerup=h.onpointercancel=h.onlostpointercapture=e=>{if(current?.h!==h)return;end();if(h.hasPointerCapture(e.pointerId))h.releasePointerCapture(e.pointerId);};
          h.onkeydown=e=>{const negative=axis==='columns'?'ArrowLeft':'ArrowUp',positive=axis==='columns'?'ArrowRight':'ArrowDown';if(e.key!==negative&&e.key!==positive)return;e.preventDefault();adjust(axis,i,e.key===negative?-20:20);};
          deck.append(h);handles.push(h);
        }
      }
      apply();return {columns,rows};
    },position,
  };
}
