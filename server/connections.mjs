import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fail} from './files.mjs';
export const speechProviders={groq:{label:'Groq',model:'whisper-large-v3-turbo',url:'https://api.groq.com/openai/v1/audio/transcriptions',env:'GROQ_API_KEY'},openai:{label:'OpenAI',model:'gpt-transcribe',url:'https://api.openai.com/v1/audio/transcriptions',env:'OPENAI_API_KEY'}};
export class Connections{
  constructor(dir,{env=process.env,fetcher=fetch,legacyGroqFile=path.join(os.homedir(),'Library/Application Support/GroqDictation/config.env')}={}){this.file=path.join(dir,'connections.json');this.env=env;this.fetcher=fetcher;this.legacyGroqFile=legacyGroqFile;}
  async read(){
    let data;try{data=JSON.parse(await fs.readFile(this.file,'utf8'));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();}catch(e){if(e.code==='ENOENT')data={};else fail('connections.json の書式を確認してください');}
    if(this.legacyGroqFile){const text=await fs.readFile(this.legacyGroqFile,'utf8').catch(()=>''),key=text.match(/^GROQ_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();Object.defineProperty(data,'_legacyGroq',{value:key,enumerable:false});}
    return data;
  }
  key(data,id){return data[id]?.apiKey||this.env[speechProviders[id].env]||(id==='groq'?data._legacyGroq:'')||'';}
  async status(){const data=await this.read();return {file:this.file,voice:Object.entries(speechProviders).map(([id,p])=>({id,label:p.label,model:data[id]?.model||p.model,configured:!!this.key(data,id)}))};}
  async save(input){
    const data=await this.read();
    for(const id of Object.keys(speechProviders))if(input[id]){
      const value=input[id];data[id]||={};
      if(value.remove)data[id].apiKey='';
      else if(value.apiKey!==undefined&&String(value.apiKey).trim()){if(typeof value.apiKey!=='string'||value.apiKey.length>4096||/[\r\n]/.test(value.apiKey))fail('APIキーを確認してください');data[id].apiKey=value.apiKey.trim();}
      if(value.model!==undefined){if(typeof value.model!=='string'||!value.model.trim()||value.model.length>100)fail('モデル名を確認してください');data[id].model=value.model.trim();}
    }
    await this.write(data);return this.status();
  }
  async write(data){await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await fs.rename(tmp,this.file);}
  async ensureFile(){try{await fs.access(this.file);}catch{await this.write(Object.fromEntries(Object.entries(speechProviders).map(([id,p])=>[id,{apiKey:'',model:p.model}])));}return {path:this.file};}
  async transcribe(bytes,mime,provider='auto'){
    if(!bytes.length||bytes.length>24*1024*1024)fail('音声は24MB以内で録音してください',413);
    if(!/^audio\/(webm|wav|mp4|mpeg|ogg)(;.*)?$/i.test(mime))fail('この音声形式には対応していません');
    const data=await this.read();if(provider==='auto')provider=Object.keys(speechProviders).find(id=>this.key(data,id));
    if(!speechProviders[provider]||!this.key(data,provider))fail('AIの接続から音声入力のAPIキーを設定してください',409);
    const p=speechProviders[provider],form=new FormData(),ext=mime.includes('mp4')?'m4a':mime.split('/')[1].split(';')[0];
    form.set('file',new Blob([bytes],{type:mime}),'dictation.'+ext);form.set('model',data[provider]?.model||p.model);form.set('response_format','json');
    if(provider==='groq')form.set('language','ja');
    let r;try{r=await this.fetcher(p.url,{method:'POST',headers:{Authorization:'Bearer '+this.key(data,provider)},body:form,signal:AbortSignal.timeout(90000),redirect:'error'});}catch{fail(p.label+' の音声入力に接続できませんでした。録音を残しているので再試行できます',502);}
    if(!r.ok)fail(p.label+(r.status===401?' のAPIキーを確認してください':r.status===429?' の利用枠を確認してください':' の音声入力でエラーが発生しました ('+r.status+')'),502);
    const result=await r.json();if(typeof result.text!=='string')fail('文字起こし結果を取得できませんでした',502);
    return {text:result.text,provider};
  }
}
