import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const exec=promisify(execFile);
const script=fileURLToPath(new URL('./desktop-recovery.ps1',import.meta.url));
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
export async function desktopSystem(action='inspect') {
  if(process.platform!=='win32')return {installed:false,running:false};
  const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Action',action],{windowsHide:true,timeout:15000,maxBuffer:65536});
  return JSON.parse(stdout.replace(/^\uFEFF/,''));
}
export async function updateDesktop() {
  // Update only the official Store package. Never force-close apps or override pins.
  const winget=path.join(process.env.LOCALAPPDATA||'','Microsoft','WindowsApps','winget.exe');
  try {
    await exec(winget,['upgrade','--id','9PLM9XGG6VKS','--exact','--source','msstore','--silent','--disable-interactivity'],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
    return 'updated';
  } catch(e) {
    if((Number(e.code)>>>0)===0x8a15002b)return 'not-applicable';
    // Store consent, policy, network and installer failures require user attention.
    throw new Error('自動更新を完了できませんでした。Microsoft Storeで更新を確認してください');
  }
}

export class DesktopRecovery {
  constructor({settings=()=>({}),save=()=>{},system=desktopSystem,upgrade=updateDesktop,now=Date.now,emit=()=>{},log=()=>{}}={}) {
    Object.assign(this,{settings,save,system,upgrade,now,emit,log});
    this.attempts=[];this.failedAt=null;this.nextAt=0;this.state={phase:'idle',message:''};
  }
  status(){const s=this.settings();return {...this.state,enabled:s.enabled!==false,autoUpdate:s.autoUpdate!==false,nextAt:this.nextAt};}
  set(phase,message,extra={}){this.state={...this.state,...extra,phase,message};this.emit(this.status());this.log('desktop.recovery '+phase);}
  healthy(){this.failedAt=null;this.nextAt=0;if(this.state.phase!=='connected')this.set('connected','接続済み');}
  failed({force=false}={}) {
    if(this.pending)return this.pending;
    if(!force&&this.settings().enabled===false)return Promise.resolve();
    const now=this.now();this.failedAt??=now;
    if(!force&&(now-this.failedAt<20000||now<this.nextAt))return Promise.resolve();
    this.pending=this.recover(force).catch(()=>this.set('unavailable','Codexの起動状態を確認できません。再試行します')).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async recover(force) {
    const now=this.now();this.nextAt=now+60000;
    this.set('checking','Codexを確認中');
    let app=await this.system('inspect');
    if(!force&&this.settings().enabled===false){this.set('paused','自動復旧は停止中');return;}
    if(!app.installed){this.set('missing','Codexアプリが見つかりません');return;}
    if(app.running){this.set('waiting','Codexは起動中 · 接続を再試行中',{version:app.version});return;}
    if(!app.healthy){this.set('updating','Codexの更新・修復完了を待っています',{version:app.version});return;}
    this.attempts=this.attempts.filter(t=>now-t<15*60000);
    if(this.attempts.length>=3){this.nextAt=this.attempts[0]+15*60000;this.set('cooldown','起動の再試行を一時停止中');return;}
    let updateWarning='';
    const settings=this.settings();
    if(this.attempts.length>=1&&settings.autoUpdate!==false&&now-(settings.lastUpdateAt||0)>6*3600000) {
      // Recheck immediately before installing; unknown/running never means safe to update.
      app=await this.system('inspect');
      if(!app.installed||app.running||!app.healthy){this.set('waiting','Codexの起動・更新完了を待っています');return;}
      this.save({lastUpdateAt:now});this.set('updating','Microsoft Storeの更新を確認中');
      try{await this.upgrade();}catch(e){updateWarning=e.message;}
    }
    if(!force&&this.settings().enabled===false){this.set('paused','自動復旧は停止中');return;}
    this.attempts.push(this.now());this.nextAt=this.now()+60000*2**(this.attempts.length-1);
    // launch checks process identity again in the same Windows helper.
    app=await this.system('launch');
    if(!app.installed){this.set('updating','Codexの更新完了を待っています');return;}
    this.set('starting',updateWarning||'Codexを起動しました · 接続待ち',{version:app.version});
  }
}
