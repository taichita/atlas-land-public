// Window-local tabs and drafts must never overwrite a different window's layout.
export const blankUI=ui=>({...ui,active:null,open:[],viewTabs:[],activeView:null,rightPane:null,browserSecondary:null,paneWorkspace:{version:1,layout:'auto',panes:[]}});
export function freshWorkspace(data){
  data.ui=blankUI(data.ui||{});data.tabs=[];data.activeTab=null;
  for(const w of Object.values(data.windows||{})){w.ui=blankUI(w.ui||{});w.tabs=[];w.activeTab=null;}
}
export function windowState(data,id='main') {
  data.windows ||= {};
  if(!Object.hasOwn(data.windows,id)) data.windows[id] = id==='main'
    ? {ui:structuredClone(data.ui||{}),tabs:structuredClone(data.tabs||[]),activeTab:data.activeTab||null}
    : {ui:{appearanceVersion:3,bodySize:data.ui?.bodySize||16,theme:data.ui?.theme,shortcuts:data.ui?.shortcuts,
        paneWorkspace:{version:1,layout:'auto',panes:[]}},tabs:[],activeTab:null};
  return data.windows[id];
}
