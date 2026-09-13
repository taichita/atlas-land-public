// Shared by the UI and server. Never infer an affirmative answer from a default.
export function formFields(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') return null;
  const fields=Object.entries(schema.properties).map(([key,s])=>({...s,key,required:(schema.required||[]).includes(key)}));
  return fields.every(s=>['string','boolean','number','integer','array'].includes(s.type) &&
    (s.type!=='array'||Array.isArray(s.items?.enum)||Array.isArray(s.items?.anyOf)) && !s.$ref && !s.allOf && !s.anyOf && !s.not) ? fields : null;
}
export function choices(s) {
  return s.oneOf?.map(o=>({value:o.const,label:o.title||o.const})) || s.enum?.map((v,i)=>({value:v,label:s.enumNames?.[i]||String(v)})) || [];
}
export function validateForm(schema, content) {
  const fields=formFields(schema);
  if(!fields)return; // openai/form schemas are opaque; keep the user's JSON intact.
  if(!content||typeof content!=='object'||Array.isArray(content))throw Error('回答を入力してください');
  for(const s of fields){
    const v=content[s.key],label=s.title||s.key;
    if(v===undefined){if(s.required)throw Error(label+'を入力してください');continue;}
    const bad=()=>{throw Error(label+'の入力内容を確認してください');};
    if(s.type==='string'){
      if(typeof v!=='string'||(s.minLength!=null&&v.length<s.minLength)||(s.maxLength!=null&&v.length>s.maxLength))bad();
      const options=choices(s);if(options.length&&!options.some(o=>o.value===v))bad();
      if(v&&s.format==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))bad();
      if(v&&s.format==='uri'){try{new URL(v);}catch{bad();}}
      if(v&&['date','date-time'].includes(s.format)&&!Number.isFinite(Date.parse(v)))bad();
    }else if(s.type==='boolean'){if(typeof v!=='boolean')bad();}
    else if(s.type==='array'){
      const opts=s.items.enum||s.items.anyOf.map(o=>o.const);
      if(!Array.isArray(v)||v.some(x=>!opts.includes(x))||new Set(v).size!==v.length||(s.minItems!=null&&v.length<s.minItems)||(s.maxItems!=null&&v.length>s.maxItems))bad();
    }else if(typeof v!=='number'||!Number.isFinite(v)||(s.type==='integer'&&!Number.isInteger(v))||(s.minimum!=null&&v<s.minimum)||(s.maximum!=null&&v>s.maximum))bad();
  }
  if(Object.keys(content).some(k=>!Object.hasOwn(schema.properties,k)))throw Error('要求されていない回答項目があります');
}
export function requestResponse(request, body) {
  const {method,params:p}=request, decision=body.decision;
  if(method.includes('requestUserInput')){
    const answers=Object.create(null);
    for(const q of p.questions||[]){const a=body.answers?.[q.id];if(!Array.isArray(a)||!a.length||!a.every(x=>typeof x==='string'&&x.trim()))throw Error('回答を入力してください');answers[q.id]={answers:a};}
    return {answers};
  }
  if(method.includes('elicitation')){
    if(!['accept','decline','cancel'].includes(decision))throw Error('判断を選択してください');
    if(decision!=='accept')return {action:decision,content:null};
    if(p.mode==='url')return {action:'accept',content:null};
    if(body.content===undefined)throw Error('回答を入力してください');
    validateForm(p.requestedSchema,body.content);
    return {action:'accept',content:body.content};
  }
  if(method.includes('permissions')){
    if(!['accept','decline'].includes(decision))throw Error('許可または拒否を選択してください');
    return {permissions:decision==='accept'?p.permissions:{},scope:'turn'};
  }
  if(!['accept','decline','cancel'].includes(decision))throw Error('判断を選択してください');
  if(p.availableDecisions?.length&&!p.availableDecisions.includes(decision))throw Error('この要求では選択できない判断です');
  return {decision};
}
