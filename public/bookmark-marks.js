export const bookmarkMarks=[{id:'star',symbol:'★',name:'スター'},{id:'heart',symbol:'♥',name:'ハート'},{id:'diamond',symbol:'◆',name:'ダイヤ'},{id:'flag',symbol:'⚑',name:'フラッグ'}];
export const bookmarkMark=value=>bookmarkMarks.find(m=>m.id===value)||bookmarkMarks[0];
export const bookmarkKey=b=>b.kind==='task'?'task:'+b.taskId:'web:'+b.url;
export function flatBookmarks(items){
 const unique=new Map();for(const b of items||[]){if(b.kind==='folder')continue;const key=bookmarkKey(b),old=unique.get(key);if(!old||bookmarkMark(old.mark).id==='star'&&bookmarkMark(b.mark).id!=='star')unique.set(key,b);}return [...unique.values()];
}
