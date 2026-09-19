const paths={
  video:'M3 5h18v14H3z M9 8l7 4-7 4z',
  image:'M3 3h18v18H3z M4 17l6-7 4 5 3-3 4 5 M15 7h.01',
  audio:'M9 18V5l11-2v13 M9 8l11-2 M9 18c0 4-7 4-7 0s7-4 7 0 M20 16c0 4-7 4-7 0s7-4 7 0',
  folder:'M2 6h8l2 3h10v11H2z M2 6V4h7l3 3',
  file:'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8',
  note:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5'
};
export const svgIcon=kind=>`<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]||paths.file}"/></svg>`;
export function fileKind(name=''){
  const ext=name.split('.').at(-1).toLowerCase();
  if(['mp4','webm','mov','m4v','mkv','avi'].includes(ext))return 'video';
  if(['png','jpg','jpeg','gif','webp','svg','avif','bmp','ico'].includes(ext))return 'image';
  if(['mp3','wav','m4a','ogg','flac','aac'].includes(ext))return 'audio';
  return 'document';
}
export function tabIcon(view,record,esc){
  const picture=(src,extra='')=>`<img class="tab-icon ${extra}" src="${esc(src)}" alt="" loading="lazy">`;
  if(view.kind==='task')return record?.provider==='claude'?picture('/assets/claude.ico','tab-icon-provider'):'<span class="tab-icon provider-openai" aria-hidden="true"></span>';
  if(view.kind==='web')return picture(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(record?.icon||'')?record.icon:'/assets/atlas-browser.png');
  if(view.kind==='folder')return svgIcon('folder');
  const kind=fileKind(view.path||view.id);
  return kind==='document'?picture('/assets/atlas-browser.png'):svgIcon(kind);
}
