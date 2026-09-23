(()=>{
  if(location.protocol!=='https:'||!['www.youtube.com','youtube.com','m.youtube.com'].includes(location.hostname)||window.__atlasYouTube)return;
  const send=data=>window.chrome?.webview?.postMessage({type:'atlas.youtube',...data});
  const id=()=>{const v=new URL(location.href).searchParams.get('v');return /^[\w-]{11}$/.test(v||'')?v:null;};
  const clock=value=>{const n=Math.max(0,Math.floor(value));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
  let host,root,videoId,lastRequested,timer;
  const style=`:host{display:block;margin:0 0 16px;font:13px/1.5 Arial,sans-serif;color:#f5f1ff}section{padding:15px;border-radius:14px;background:#25212d;border:1px solid #65547c}header{display:flex;align-items:center;gap:8px}strong{flex:1;font-size:14px}button{cursor:pointer;border:1px solid #70617f;border-radius:8px;padding:6px 9px;background:#393043;color:inherit;font:inherit}button:hover{background:#58436d}.tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.status{padding:12px 0;color:#eee6fa}svg{width:100%;height:145px;display:block}text{font:11px Arial;fill:#eee6fa}.card{display:flex;gap:8px;padding:10px 0}.thumb{width:168px;flex-shrink:0;position:relative}.thumb img{width:168px;height:94px;border-radius:8px;object-fit:cover}.duration{position:absolute;bottom:6px;right:4px;background:#000d;padding:1px 4px;border-radius:3px;font-size:11px}.title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;font-weight:bold;line-height:20px}.channel{font-size:12px;margin-top:5px;color:#dfd7e8}.preview{margin-top:12px;border-top:1px solid #65547c}a{color:#d6b8ff}`;
  const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  function request(refresh=false){if(!videoId)return;send({action:'retention',videoId,refresh});lastRequested=videoId;}
  function mount(){
    const next=id();if(!next){host?.remove();host=null;lastRequested=null;return;}
    const target=document.querySelector('ytd-watch-flexy #secondary-inner')||document.querySelector('ytd-watch-flexy #secondary')||document.querySelector('#related');
    if(!target)return;
    if(!host?.isConnected){
      host=el('div');host.id='atlas-youtube-tools';root=host.attachShadow({mode:'closed'});
      // YouTube enforces Trusted Types. Build nodes instead of assigning HTML.
      const section=el('section'),heading=el('header'),refresh=el('button','↻'),status=el('div','読み込み中…'),graph=el('div'),tools=el('div'),previewBox=el('div');
      refresh.id='refresh';refresh.title='更新';heading.append(el('strong','視聴者維持率'),refresh);status.className='status';graph.id='graph';tools.className='tools';previewBox.id='preview-card';previewBox.hidden=true;
      for(const [key,label,title]of [['connect','Studio接続',''],['capture','文字起こし＋スクショ','Ctrl+Shift+Y'],['preview','おすすめ表示','Ctrl+Alt+Y']]){const b=el('button',label);b.id=key;b.title=title;tools.append(b);}
      section.append(heading,status,graph,tools,previewBox);root.append(el('style',style),section);target.prepend(host);
      root.querySelector('#refresh').onclick=()=>request(true);
      root.querySelector('#connect').onclick=()=>send({action:'connect',videoId});
      root.querySelector('#capture').onclick=()=>send({action:'capture',videoId});
      root.querySelector('#preview').onclick=()=>preview();
    }
    if(videoId!==next){videoId=next;root.querySelector('.status').textContent='読み込み中…';root.querySelector('#graph').replaceChildren();root.querySelector('#preview-card').hidden=true;}
    if(lastRequested!==videoId)request();
  }
  function render(payload){
    if(payload.videoId!==id()||!root)return;
    const status=root.querySelector('.status'),graph=root.querySelector('#graph');graph.replaceChildren();
    if(payload.error){status.textContent=payload.error;return;}
    const points=(payload.points||[]).filter(p=>Number.isFinite(p.position)&&Number.isFinite(p.ratio)&&p.position>=0&&p.position<=1&&p.ratio>=0);
    if(!points.length){status.textContent='データがありません（自分の動画・集計済みの期間が対象）';return;}
    const duration=document.querySelector('video')?.duration||0,max=Math.max(1,...points.map(p=>p.ratio));
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 145');svg.setAttribute('aria-label','YouTube Studio 視聴者維持率');
    const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;svg.append(e);return e;};
    for(const ratio of [0,0.5,1]){const y=112-ratio*90;add('line',{x1:35,x2:310,y1:y,y2:y,stroke:'#665775'});add('text',{x:0,y:y+4},Math.round(ratio*max*100)+'%');}
    add('polyline',{points:points.map(p=>(35+p.position*275)+','+(112-p.ratio/max*90)).join(' '),fill:'none',stroke:'#cfa8ff','stroke-width':2.5});
    add('text',{x:35,y:136},'0:00');add('text',{x:310,y:136,'text-anchor':'end'},Number.isFinite(duration)&&duration?clock(duration):'動画の終わり');
    const marker=add('line',{x1:35,x2:35,y1:17,y2:114,stroke:'#fff',opacity:0});
    svg.onpointermove=e=>{const r=svg.getBoundingClientRect(),pos=Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*320-35)/275)),p=points.reduce((a,b)=>Math.abs(b.position-pos)<Math.abs(a.position-pos)?b:a);marker.setAttribute('x1',35+p.position*275);marker.setAttribute('x2',35+p.position*275);marker.setAttribute('opacity',1);status.textContent=clock(p.position*duration)+' · '+(p.ratio*100).toFixed(1)+'%';};
    svg.onclick=e=>{const v=document.querySelector('video');if(v&&Number.isFinite(v.duration)){const r=svg.getBoundingClientRect();v.currentTime=Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*320-35)/275))*v.duration;}};
    status.textContent='全期間 · '+new Date(payload.fetchedAt).toLocaleDateString();graph.append(svg);
  }
  function metadata(){const p=document.querySelector('#movie_player')?.getPlayerResponse?.(),d=p?.videoDetails||{};return {videoId:id(),title:d.title||document.querySelector('h1 yt-formatted-string')?.textContent||document.title.replace(/ - YouTube$/,''),channel:d.author||document.querySelector('#owner #channel-name')?.textContent?.trim()||'',duration:Number(d.lengthSeconds)||document.querySelector('video')?.duration||0,currentTime:document.querySelector('video')?.currentTime||0,player:p};}
  function preview(){mount();if(!root)return;const box=root.querySelector('#preview-card');if(!box.hidden){box.hidden=true;return;}const m=metadata();box.replaceChildren();box.className='preview';box.hidden=false;box.append(el('div','おすすめ欄での見え方'));
    const card=el('div');card.className='card';const thumb=el('div');thumb.className='thumb';const img=el('img');img.src='https://i.ytimg.com/vi/'+m.videoId+'/mqdefault.jpg';img.alt='';thumb.append(img);const time=el('span',clock(m.duration));time.className='duration';thumb.append(time);const detail=el('div'),title=el('div',m.title),channel=el('div',m.channel);title.className='title';channel.className='channel';detail.append(title,channel);card.append(thumb,detail);box.append(card);host.scrollIntoView({block:'nearest'});
  }
  async function capture(requestId){
    const m=metadata();let transcript='',transcriptError='';
    try{
      const tracks=m.player?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[],track=tracks.find(t=>t.languageCode==='ja'&&t.kind!=='asr')||tracks.find(t=>t.languageCode==='ja')||tracks[0];
      if(track?.baseUrl){const url=new URL(track.baseUrl);if(url.protocol!=='https:'||!['www.youtube.com','youtube.com'].includes(url.hostname))throw Error('字幕の接続先を確認できません');url.searchParams.set('fmt','json3');const r=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('字幕を取得できません');const data=await r.json();transcript=(data.events||[]).filter(e=>e.segs).map(e=>'['+clock((e.tStartMs||0)/1000)+'] '+e.segs.map(s=>s.utf8||'').join('')).join('\n');}
      if(!transcript){const segments=[...document.querySelectorAll('ytd-transcript-segment-renderer')];transcript=segments.map(s=>s.innerText.trim()).join('\n');}
      if(!transcript)transcriptError='字幕がないか、YouTubeから字幕を取得できませんでした。';
    }catch{transcriptError='YouTubeから字幕を取得できませんでした。';}
    if(!transcript&&m.videoId===id()){
      const button=document.querySelector('ytd-video-description-transcript-section-renderer button');
      if(button){button.click();for(let attempt=0;attempt<40&&m.videoId===id();attempt++){await new Promise(r=>setTimeout(r,150));const segments=[...document.querySelectorAll('ytd-transcript-segment-renderer')];if(segments.length){transcript=segments.map(s=>s.innerText.trim()).join('\n');transcriptError='';break;}}}
    }
    if(m.videoId!==id()){send({action:'captured',requestId,error:'動画が切り替わったため、もう一度取得してください'});return;}
    const {player,...data}=m;send({action:'captured',requestId,payload:{...data,transcript:transcript.slice(0,1000000),transcriptError}});
  }
  window.__atlasYouTube={render,preview,capture};
  const schedule=()=>{if(timer)return;timer=setTimeout(()=>{timer=null;mount();},400);};
  document.addEventListener('yt-navigate-finish',schedule);
  const start=()=>{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});mount();};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
