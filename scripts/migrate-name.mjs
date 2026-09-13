import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previous = path.join(path.dirname(root),'ai-workspace');
const file = path.join(process.env.LOCALAPPDATA,'PersonalAIWorkspace','data','workspace.json');
const state = JSON.parse(fs.readFileSync(file,'utf8'));
if(state.tasks.some(t => t.activeTurn || t.queue || t.state === 'starting')) throw Error('Active task; do not migrate');
const nextPath = p => typeof p === 'string' && (p.toLowerCase() === previous.toLowerCase() || p.toLowerCase().startsWith(previous.toLowerCase()+path.sep)) ? root+p.slice(previous.length) : p;
let changed = 0;
for(const t of state.tasks) {
  const cwd = nextPath(t.cwd);
  if(cwd !== t.cwd) { t.cwd=cwd; changed++; }
}
if(changed) {
  fs.copyFileSync(file,file+'.before-atlas-'+Date.now()+'.bak');
  fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2));
  fs.renameSync(file+'.tmp',file);
}
console.log(JSON.stringify({migratedTasks:changed,root,profile:'PersonalAIWorkspace (unchanged)'}));
