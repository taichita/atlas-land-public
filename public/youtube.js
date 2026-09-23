export function setupYouTube({api,host,toast,openDialog,closeDialog,header,esc,openFile}){
  let capturing=false;
  async function connect(){
    const status=await api('/youtube/status');
    openDialog(header('YouTube Studio')+'<p>'+ (status.connected?'接続済み':status.configured?'Googleの許可待ち':'初回設定')+'</p><p>Google CloudでYouTube Analytics APIを有効にし、デスクトップアプリ用OAuth JSONを選択してください。</p><label class="form-field">OAuth JSON<input id="youtube-client" type="file" accept=".json,application/json"></label><p id="youtube-status"></p><div class="dialog-actions"><button id="youtube-login" class="primary" '+(!status.configured?'disabled':'')+'>Googleに接続</button></div><p class="small">認証画面は既定のブラウザで開きます。チャンネルの読み取りだけを許可します。</p>');
    document.getElementById('youtube-client').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('OAuth JSONを選んでください');await api('/youtube/configure',JSON.parse(await file.text()));document.getElementById('youtube-login').disabled=false;document.getElementById('youtube-status').textContent='設定しました';}catch(error){document.getElementById('youtube-status').textContent=error.message;}};
    document.getElementById('youtube-login').onclick=async()=>{try{const r=await api('/youtube/authorize',{});await host('youtube.oauth.open',{url:r.url});document.getElementById('youtube-status').textContent='ブラウザで許可した後、動画の ↻ を押してください';}catch(error){document.getElementById('youtube-status').textContent=error.message;}};
  }
  async function capture(id){
    if(!id)throw Error('YouTubeの動画を開いてください');
    if(capturing)return;capturing=true;toast('文字起こしとスクショを取得中…');
    try{
      const screenshot=await host('browser.youtube.screenshot',{id});
      const data=await host('browser.youtube.transcript',{id});
      if(!data?.videoId)throw Error('YouTubeの動画を開いてください');
      if(new URL(screenshot.url).searchParams.get('v')!==data.videoId)throw Error('動画が切り替わりました。再取得してください');
      const saved=await api('/youtube/capture',{...data,screenshot:screenshot.bytes});
      openDialog(header('YouTubeを保存')+'<p>'+esc(data.title)+'</p><p>'+(saved.hasTranscript?'文字起こしとスクリーンショットを保存しました。':'スクリーンショットを保存しました。字幕は取得できませんでした。')+'</p><div class="dialog-actions"><button id="youtube-open-text">文字起こし</button><button id="youtube-open-image">スクショ</button><button id="youtube-open-folder">保存先を開く</button></div><p class="small" style="overflow-wrap:anywhere">'+esc(saved.folder)+'</p>');
      document.getElementById('youtube-open-text').onclick=()=>{closeDialog();openFile(saved.path).catch(e=>toast(e.message));};
      document.getElementById('youtube-open-image').onclick=()=>{closeDialog();openFile(saved.image).catch(e=>toast(e.message));};
      document.getElementById('youtube-open-folder').onclick=()=>host('file.reveal',{path:saved.path}).catch(e=>toast(e.message));
    }finally{capturing=false;}
  }
  async function event(m){
    if(m.type!=='browser.youtube')return;
    if(m.action==='connect')return connect();
    if(m.action==='capture')return capture(m.id);
    if(m.action==='retention'){
      let payload;
      try{payload=await api('/youtube/retention?video='+encodeURIComponent(m.videoId)+(m.refresh?'&refresh=1':''));}
      catch(e){payload={videoId:m.videoId,error:e.message};}
      await host('browser.youtube.render',{id:m.id,payload});
    }
  }
  return {capture,connect,event};
}
