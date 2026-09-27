export async function mountDesktopRecovery(container,{api,toast,openWeb}) {
  const value=await api('/desktop/recovery');
  if(!container.isConnected)return;
  const section=document.createElement('div');section.className='form-field';
  section.innerHTML='<label>Codexアプリの復旧</label><p id="desktop-recovery-status" role="status"></p><label><input type="checkbox" id="desktop-auto-recover"> 切断時に自動復旧</label><label><input type="checkbox" id="desktop-auto-update"> 起動失敗が続くときにStoreの更新を試す</label><div class="dialog-actions"><button id="desktop-recover-now">今すぐ復旧</button><button id="desktop-update-help">更新の案内</button></div>';
  container.querySelector('.dialog-actions').before(section);
  const status=section.querySelector('#desktop-recovery-status');
  status.textContent=value.message||'接続断が続いた場合に確認します';
  for(const [id,key] of [['desktop-auto-recover','enabled'],['desktop-auto-update','autoUpdate']]){
    const input=section.querySelector('#'+id);input.checked=value[key];
    input.onchange=async()=>{input.disabled=true;try{await api('/desktop/recovery',{[key]:input.checked});}catch(e){input.checked=!input.checked;toast(e.message);}finally{input.disabled=false;}};
  }
  section.querySelector('#desktop-recover-now').onclick=async e=>{
    e.target.disabled=true;
    try{await api('/desktop/recover',{});status.textContent='接続を確認しています';}catch(error){toast(error.message);}finally{e.target.disabled=false;}
  };
  section.querySelector('#desktop-update-help').onclick=()=>openWeb('https://learn.chatgpt.com/docs/windows/windows-app');
}
