import {formFields,choices,validateForm} from './approval-forms.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function requestKey(id){return JSON.stringify(id);}
function fieldHTML(s,index){
  const attrs=`data-form-field="${index}" aria-label="${esc(s.title||s.key)}"`, options=choices(s);
  let control;
  if(s.type==='boolean')control=`<select ${attrs}><option value="">選択してください</option><option value="true">はい</option><option value="false">いいえ</option></select>`;
  else if(options.length)control=`<select ${attrs}><option value="">選択してください</option>${options.map((o,i)=>`<option value="${i}">${esc(o.label)}</option>`).join('')}</select>`;
  else if(s.type==='array')control=`<div ${attrs}>${(s.items.enum?.map(v=>({const:v,title:v}))||s.items.anyOf).map((o,i)=>`<label><input type="checkbox" data-option="${i}">${esc(o.title||o.const)}</label>`).join('')}</div>`;
  else if(['number','integer'].includes(s.type))control=`<input ${attrs} type="number" step="${s.type==='integer'?'1':'any'}" ${s.minimum!=null?`min="${esc(s.minimum)}"`:''} ${s.maximum!=null?`max="${esc(s.maximum)}"`:''}>`;
  else control=`<textarea ${attrs} rows="2" ${s.maxLength!=null?`maxlength="${esc(s.maxLength)}"`:''}></textarea>`;
  return `<label class="form-field"><span>${esc(s.title||s.key)}${s.required?' *':''}</span>${s.description?`<small>${esc(s.description)}</small>`:''}${control}</label>`;
}
export function requestHTML(r){
  const p=r.params, user=r.method.includes('UserInput'), elicitation=r.method.includes('elicitation');
  const fields=elicitation?formFields(p.requestedSchema):null;
  let form='',buttons='';
  if(user){
    form=(p.questions||[]).map(q=>`<label class="form-field"><span>${esc(q.question)}</span><textarea data-question="${esc(q.id)}" rows="2" placeholder="回答を入力"></textarea>${q.options?.length?`<span class="answer-options">${q.options.map(o=>`<button type="button" data-choice-question="${esc(q.id)}" data-choice-value="${esc(o.label)}" title="${esc(o.description||'')}">${esc(o.label)}</button>`).join('')}</span>`:''}</label>`).join('');
    buttons='<button data-answer="submit" class="primary">回答する</button>';
  }else if(elicitation){
    if(p.mode==='url'){
      let safe=false;try{safe=['http:','https:'].includes(new URL(p.url).protocol);}catch{}
      form=safe?`<button type="button" data-request-url="${esc(p.url)}">確認ページを開く</button>`:'<p>確認ページのURLを開けません。</p>';
      if(safe)buttons='<button data-answer="accept" class="primary">確認ページで完了しました</button>';
    }else{
      form=fields?fields.map(fieldHTML).join(''):`<label class="form-field"><span>回答内容（JSON）</span><textarea data-form-json rows="5" placeholder="要求された回答を入力"></textarea></label>`;
      buttons='<button data-answer="accept" class="primary">'+(fields?.length?'回答して進める':'この操作を許可')+'</button>';
    }
    buttons+='<button data-answer="decline">拒否</button><button data-answer="cancel">キャンセル</button>';
  }else{
    const available=p.availableDecisions||['accept','decline','cancel'];
    buttons=[['accept','この操作を許可'],['decline','拒否'],['cancel','中断']].filter(([d])=>available.includes(d)&&!(r.method.includes('permissions')&&d==='cancel')).map(([d,label])=>`<button data-answer="${d}" ${d==='accept'?'class="primary"':''}>${label}</button>`).join('');
  }
  return `<div class="request-card" data-request="${esc(requestKey(r.id))}"><h3>${user?'AIからの質問':'確認が必要です'}</h3>${p.message||p.reason?`<p class="request-message">${esc(p.message||p.reason)}</p>`:''}${p.command?`<pre>${esc(p.command)}</pre>`:''}${form}<details><summary>対象と理由</summary><pre>${esc(JSON.stringify(p,null,2))}</pre></details><p class="request-error" role="alert" hidden></p><div class="request-buttons">${buttons}</div></div>`;
}
export function readRequestForm(card,request){
  const p=request.params;if(p.mode==='url')return null;
  const fields=formFields(p.requestedSchema);
  if(!fields){try{return JSON.parse(card.querySelector('[data-form-json]').value);}catch{throw Error('回答内容を有効なJSONで入力してください');}}
  const content=Object.create(null);
  fields.forEach((s,index)=>{
    const el=card.querySelector(`[data-form-field="${index}"]`), opts=choices(s);
    if(s.type==='array'){const options=s.items.enum||s.items.anyOf.map(o=>o.const);content[s.key]=[...el.querySelectorAll('input:checked')].map(e=>options[Number(e.dataset.option)]);}
    else if(el.value!=='')content[s.key]=s.type==='boolean'?el.value==='true':opts.length?opts[Number(el.value)].value:['number','integer'].includes(s.type)?Number(el.value):el.value;
    else if(s.type==='string'&&!opts.length&&s.required&&s.minLength!==0)throw Error((s.title||s.key)+'を入力してください');
  });
  validateForm(p.requestedSchema,content);return content;
}
