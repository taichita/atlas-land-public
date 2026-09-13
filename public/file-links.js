// Resolve local document links without treating drive letters as URL schemes.
export function fileLink(href, currentPath = '', cwd = '') {
  if (/^https?:\/\//i.test(href)) return {web:href};
  if (href.startsWith('#')) {try{return {anchor:decodeURIComponent(href.slice(1))};}catch{return {anchor:href.slice(1)};}}
  let value;
  const withoutFragment=href.replace(/#.*$/,'');
  try { value=decodeURIComponent(withoutFragment); } catch { value=withoutFragment; }
  value=value.replace(/^file:(?:\/\/(?:localhost)?\/|\/(?=[a-z]:[\\/]))/i,'').replace(/^\/([a-z]:[\\/])/i,'$1');
  const localTarget=(filename)=>{
    const normalized=filename.replace(/\\/g,'/'), root=cwd.replace(/\\/g,'/').replace(/\/$/,'')+'/';
    if(cwd&&normalized.toLowerCase().startsWith(root.toLowerCase()))return {relative:normalized.slice(root.length)};
    return {local:filename};
  };
  if (/^[a-z]:[\\/]/i.test(value)) return localTarget(value.replace(/:\d+(?::\d+)?$/,''));
  if (/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('//')||value.startsWith('\\\\')) return null;
  value=value.replace(/:\d+(?::\d+)?$/,'');
  const base=currentPath ? currentPath.replace(/\\/g,'/').split('/').slice(0,-1).join('/') : '';
  if (/^[a-z]:[\\/]/i.test(base)) return localTarget(base+'/'+value);
  const relative=value.startsWith('/')?value.slice(1):(base?base+'/':'')+value;
  return {relative};
}
