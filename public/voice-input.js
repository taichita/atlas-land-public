export function setupVoice({button,choice,api,token,taskId,insert,settings,toast}){
  let recorder,stream,chunks=[],timer,pendingAudio=null,target=null,busy=false,starting=false,provider='auto',recordingAt=0;
  const cancel=document.createElement('button');cancel.type='button';cancel.hidden=true;cancel.textContent='×';cancel.title='録音を破棄';cancel.id='voice-cancel';button.after(cancel);
  const reset=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;button.classList.remove('recording');button.textContent='🎙';button.title='音声入力';};
  async function transcribe(){
    busy=true;button.disabled=true;cancel.hidden=true;button.textContent='…';
    try{const r=await fetch('/api/voice/transcribe?provider='+encodeURIComponent(provider),{method:'POST',headers:{'x-workspace-token':token,'Content-Type':pendingAudio.type},body:pendingAudio});const data=await r.json();if(!r.ok)throw Error(data.error);insert(target,data.text);pendingAudio=null;}
    catch(e){toast(e.message+' · マイクボタンでもう一度試せます');}
    finally{busy=false;button.disabled=false;reset();cancel.hidden=!pendingAudio;if(pendingAudio){button.textContent='↻';button.title='録音の文字起こしを再試行';}}
  }
  cancel.onclick=()=>{if(busy||starting)return;if(recorder){recorder.onstop=null;if(recorder.state==='recording')recorder.stop();}pendingAudio=null;chunks=[];reset();cancel.hidden=true;};
  button.addEventListener('click',async()=>{
    if(busy||starting)return;
    if(recorder?.state==='recording'){recorder.stop();return;}
    if(pendingAudio){await transcribe();return;}
    target=taskId();if(!target){toast('案件を開いてください');return;}
    starting=true;
    try{
      const status=await api('/connections');provider=choice();if(!status.voice.some(p=>p.configured&&(provider==='auto'||p.id===provider))){await settings();return;}
      stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});recordingAt=Date.now();
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onerror=()=>{recorder.onstop=null;reset();cancel.hidden=true;toast('録音できませんでした。マイクを確認してください');};
      recorder.onstop=async()=>{const type=recorder?.mimeType||mime||'audio/webm';pendingAudio=new Blob(chunks,{type});reset();cancel.hidden=true;if(Date.now()-recordingAt<400||!pendingAudio.size){pendingAudio=null;return;}await transcribe();};
      recorder.start(1000);cancel.hidden=false;button.classList.add('recording');button.textContent='■';button.title='録音を終了して入力';timer=setTimeout(()=>recorder?.state==='recording'&&recorder.stop(),10*60*1000);
    }catch(e){reset();toast(e.name==='NotAllowedError'?'マイクの許可を確認してください':e.message);}finally{starting=false;}
  });
  window.addEventListener('pagehide',()=>{if(recorder)recorder.onstop=null;reset();});
  return {active:()=>starting||busy||!!recorder||!!pendingAudio};
}
