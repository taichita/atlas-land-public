export function googleTranslationURL(value){
  let source;try{source=new URL(value);}catch{throw new Error('Webページを開いてください');}
  const host=source.hostname.toLowerCase();
  if(!['https:','http:'].includes(source.protocol)||source.username||source.password||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')||host.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(host))throw new Error('ローカル・社内ページはCodex翻訳を選んでください');
  if([...source.searchParams.keys()].some(k=>/^(access_token|id_token|token|api_key|apikey|password|code|auth|signature|sig)$/i.test(k)))throw new Error('認証情報を含むURLはCodex翻訳を選んでください');
  if(host==='translate.google.com'||host.endsWith('.translate.goog'))throw new Error('このページはGoogle翻訳で開いています');
  source.hash='';const target=new URL('https://translate.google.com/translate');target.searchParams.set('sl','auto');target.searchParams.set('tl','ja');target.searchParams.set('u',source.href);return target.href;
}
