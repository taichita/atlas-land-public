// Executed by Node as <temporary cwd>/app-server. No OpenAI calls.
const fs=require('node:fs'),readline=require('node:readline');
const turns=[],pending=new Map();let sequence=0;
const out=m=>process.stdout.write(JSON.stringify(m)+'\n');
const note=(method,params)=>out({method,params});
const complete=t=>{t.status='completed';note('turn/completed',{threadId:'image-test',turn:t});};
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(process.env.ATLAS_FAKE_LOG,JSON.stringify(m)+'\n');
 if(!m.method){const p=pending.get(m.id);if(p){pending.delete(m.id);note('serverRequest/resolved',{threadId:'image-test',requestId:m.id});if(!pending.size)complete(p);}return;}
 if(m.id===undefined)return;
 let result={};
 if(m.method==='model/list')result={data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
 if(m.method==='thread/resume')result={thread:{id:'image-test'}};
 if(m.method==='thread/turns/list')result={data:[...turns].reverse(),nextCursor:null};
 if(m.method==='turn/start'){
   const t={id:'turn-'+(++sequence),status:'inProgress',items:[{id:'message-'+sequence,type:'userMessage',content:m.params.input}]};turns.push(t);result={turn:t};
   out({id:m.id,result});note('turn/started',{threadId:'image-test',turn:t});
   note('item/completed',{threadId:'image-test',turnId:t.id,item:t.items[0]});
   const text=m.params.input.find(i=>i.type==='text')?.text||'';
   if(text==='ASK_FORM'){
     for(const id of ['approval:one','approval:two']){
       pending.set(id,t);
       out({id,method:'mcpServer/elicitation/request',params:{threadId:'image-test',turnId:t.id,serverName:'fixture',mode:'form',message:'テスト用ファイルの確認です。',requestedSchema:{type:'object',properties:{decision:{type:'string',title:'操作',enum:['allow','deny'],enumNames:['許可する','拒否する']},confirmed:{type:'boolean',title:'内容を確認しました'},note:{type:'string',title:'メモ'}},required:['decision','confirmed']}}});
     }
   }else setTimeout(()=>complete(t),10);
   return;
 }
 out({id:m.id,result});
});
