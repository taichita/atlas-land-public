import fs from 'node:fs/promises';
export const accessModes=['danger-full-access','workspace-write','read-only'];
export function applyInstallation(data,config){
  if(!config||config.channel!=='internal')return false;
  let changed=false;
  const defaults={defaultFolder:config.workFolder,defaultAccess:accessModes.includes(config.access)?config.access:'danger-full-access',chromeSync:!!config.chromeSync};
  for(const [key,value] of Object.entries(defaults))if(data[key]===undefined&&value!==undefined){data[key]=value;changed=true;}
  return changed;
}
export async function readInstallation(file){
  try{return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
