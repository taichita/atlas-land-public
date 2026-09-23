import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {fail} from './files.mjs';

export const videoId = value => /^[\w-]{11}$/.test(String(value)) ? String(value) : fail('YouTubeの動画を開いてください');
export function retentionRows(report) {
  const names=(report.columnHeaders||[]).map(c=>c.name),x=names.indexOf('elapsedVideoTimeRatio'),y=names.indexOf('audienceWatchRatio');
  if(x<0||y<0)return [];
  return (report.rows||[]).map(row=>({position:Number(row[x]),ratio:Number(row[y])})).filter(p=>Number.isFinite(p.position)&&Number.isFinite(p.ratio)&&p.position>=0&&p.position<=1&&p.ratio>=0).sort((a,b)=>a.position-b.position);
}
export class YouTube {
  constructor(dir,{fetcher=fetch}={}){this.dir=path.join(dir,'youtube');this.fetcher=fetcher;this.cache=new Map();this.pending=new Map();}
  async read(name){return JSON.parse(await fs.readFile(path.join(this.dir,name),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));}
  async write(name,value){await fs.mkdir(this.dir,{recursive:true});const file=path.join(this.dir,name),tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600});await fs.rename(tmp,file);}
  async status(){const config=await this.read('oauth-client.json'),tokens=await this.read('tokens.json');return {configured:!!config.client_id,connected:!!tokens.refresh_token||!!tokens.access_token};}
  async configure(value){const c=value?.installed;if(!c||typeof c.client_id!=='string'||!c.client_id.endsWith('.apps.googleusercontent.com')||c.client_id.length>300)fail('Google Cloudのデスクトップアプリ用OAuth JSONを選んでください');await this.write('oauth-client.json',{client_id:c.client_id,client_secret:String(c.client_secret||'').slice(0,500)});await this.write('tokens.json',{});this.cache.clear();return this.status();}
  async tokenRequest(params){const r=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)fail('Googleに再接続してください',409);return r.json();}
  async authorize(){
    const config=await this.read('oauth-client.json');if(!config.client_id)fail('先にOAuth JSONを選んでください',409);
    this.listener?.close();
    const state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
    const listener=http.createServer(async(req,res)=>{
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname!=='/oauth/callback'||url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid state');return;}
      if(used){res.writeHead(409);res.end('Already handled');return;}used=true;
      try{
        if(!url.searchParams.get('code'))throw Error('Googleへの接続がキャンセルされました');
        const tokens=await this.tokenRequest({...config,code:url.searchParams.get('code'),code_verifier:verifier,grant_type:'authorization_code',redirect_uri:redirect});
        await this.write('tokens.json',{...tokens,expires_at:Date.now()+(tokens.expires_in||3600)*1000});this.cache.clear();
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end('<h1>Atlas Browser に接続しました</h1><p>Atlasの動画ページに戻り、視聴者維持率の更新ボタンを押してください。</p>');
      }catch(e){res.writeHead(400,{'content-type':'text/plain; charset=utf-8'});res.end('接続できませんでした。Atlasから再接続してください。');}
      finally{clearTimeout(timer);listener.close();}
    });
    let used=false,redirect,timer;
    await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
    this.listener=listener;redirect='http://127.0.0.1:'+listener.address().port+'/oauth/callback';
    timer=setTimeout(()=>listener.close(),10*60*1000);timer.unref();
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.client_id,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly',access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return {url:url.href};
  }
  async accessToken(){
    let tokens=await this.read('tokens.json');
    if(tokens.access_token&&tokens.expires_at>Date.now()+60000)return tokens.access_token;
    if(!tokens.refresh_token)fail('YouTube Studioに接続してください',409);
    if(!this.refreshing)this.refreshing=(async()=>{const c=await this.read('oauth-client.json'),next=await this.tokenRequest({...c,refresh_token:tokens.refresh_token,grant_type:'refresh_token'});tokens={...tokens,...next,expires_at:Date.now()+(next.expires_in||3600)*1000};await this.write('tokens.json',tokens);return tokens.access_token;})().finally(()=>this.refreshing=null);
    return this.refreshing;
  }
  async retention(id,refresh=false){
    id=videoId(id);const cached=this.cache.get(id);if(!refresh&&cached&&Date.now()-cached.fetchedAt<10*60*1000)return cached;
    if(this.pending.has(id))return this.pending.get(id);
    const work=(async()=>{
      const access=await this.accessToken(),url=new URL('https://youtubeanalytics.googleapis.com/v2/reports');
      url.search=new URLSearchParams({ids:'channel==MINE',startDate:'2008-07-01',endDate:new Date().toISOString().slice(0,10),metrics:'audienceWatchRatio',dimensions:'elapsedVideoTimeRatio',filters:'video=='+id}).toString();
      const r=await this.fetcher(url,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000),redirect:'error'});
      if(!r.ok)fail(r.status===403?'このチャンネルの権限、またはYouTube Analytics APIの有効化を確認してください':r.status===401?'Googleに再接続してください':'視聴者維持率を取得できませんでした ('+r.status+')',r.status===401?409:502);
      const result={videoId:id,points:retentionRows(await r.json()),fetchedAt:Date.now()};this.cache.set(id,result);if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);return result;
    })().finally(()=>this.pending.delete(id));this.pending.set(id,work);return work;
  }
  async capture(input){
    const id=videoId(input.videoId),text=String(input.transcript||'');if(text.length>1000000)fail('文字起こしが長すぎます');
    const screenshot=String(input.screenshot||'');if(!/^[A-Za-z0-9+/=]+$/.test(screenshot)||screenshot.length>3500000)fail('スクリーンショットを取得できませんでした');
    const bytes=Buffer.from(screenshot,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('画像形式を確認してください');
    const folder=path.join(this.dir,'captures',new Date().toISOString().replace(/[:.]/g,'-')+'-'+id);await fs.mkdir(folder,{recursive:true});
    const note='# '+String(input.title||id).slice(0,500)+'\n\nhttps://www.youtube.com/watch?v='+id+'\n\n再生位置: '+Math.max(0,Number(input.currentTime)||0).toFixed(1)+' 秒\n\n'+(text||'字幕を取得できませんでした。'+String(input.transcriptError||'字幕がない動画です。').slice(0,300))+'\n';
    await fs.writeFile(path.join(folder,'screen.png'),bytes);await fs.writeFile(path.join(folder,'transcript.md'),note);return {folder,path:path.join(folder,'transcript.md'),image:path.join(folder,'screen.png'),hasTranscript:!!text};
  }
  close(){this.listener?.close();}
}
