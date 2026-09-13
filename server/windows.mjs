// Window-local tabs and drafts must never overwrite a different window's layout.
export function windowState(data,id='main') {
  data.windows ||= {};
  if(!Object.hasOwn(data.windows,id)) data.windows[id] = id==='main'
    ? {ui:structuredClone(data.ui||{}),tabs:structuredClone(data.tabs||[]),activeTab:data.activeTab||null}
    : {ui:{appearanceVersion:3,bodySize:data.ui?.bodySize||16,theme:data.ui?.theme,shortcuts:data.ui?.shortcuts,
        paneWorkspace:{version:1,layout:'columns',panes:[{id:'companion',snapshot:{views:[],tabs:[],activeView:null}}]}},tabs:[],activeTab:null};
  return data.windows[id];
}
