export const fontPresets = {
  mincho:{label:'明朝 · 読書',reading:'"Shippori Mincho", "Yu Mincho", serif'},
  sans:{label:'ゴシック · 標準',reading:'"Zen Kaku Gothic New", "Yu Gothic UI", Meiryo, sans-serif'},
  system:{label:'Windows · シンプル',reading:'"Yu Gothic UI", Meiryo, sans-serif'},
  mono:{label:'等幅 · 開発',reading:'Consolas, "BIZ UDGothic", Meiryo, monospace'},
};
export const themePresets = [
  {id:'nebula',label:'Nebula',mode:'dark',accent:'#b88aff',hue:270,saturation:4,brightness:35,font:'mincho',glow:.65,bodySize:16},
  {id:'midnight',label:'Midnight',mode:'dark',accent:'#8bbaff',hue:225,saturation:22,brightness:25,font:'sans',glow:.3,bodySize:16},
  {id:'code',label:'Code',mode:'dark',accent:'#64d4b4',hue:210,saturation:4,brightness:45,font:'mono',glow:.15,bodySize:15},
  {id:'paper',label:'Paper',mode:'light',accent:'#7950b3',hue:40,saturation:30,brightness:65,font:'mincho',glow:.1,bodySize:17},
  {id:'lavender',label:'Lavender',mode:'light',accent:'#7543b4',hue:270,saturation:25,brightness:85,font:'sans',glow:.2,bodySize:16},
  {id:'daylight',label:'Daylight',mode:'light',accent:'#1768a6',hue:210,saturation:10,brightness:100,font:'system',glow:0,bodySize:16},
];
export const defaultTheme = {...themePresets[0],preset:'nebula',motion:true};
const number=(v,f,min,max)=>v!=null&&Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):f;
export function normalizeTheme(value = {}) {
  value ||= {};
  return {preset:themePresets.some(p=>p.id===value.preset)?value.preset:'custom',
    mode:value.mode==='light'?'light':'dark',accent:/^#[0-9a-f]{6}$/i.test(value.accent)?value.accent:defaultTheme.accent,
    hue:number(value.hue,270,0,360),saturation:number(value.saturation,4,0,40),brightness:number(value.brightness,35,0,100),
    font:Object.hasOwn(fontPresets,value.font)?value.font:'mincho',glow:number(value.glow,.65,0,1),motion:value.motion!==false};
}
export function themeTokens(value){
  const t=normalizeTheme(value),light=t.mode==='light',level=light?89+t.brightness*.1:6+t.brightness*.14;
  const color=n=>`hsl(${t.hue} ${t.saturation}% ${n}%)`;
  const rgb=t.accent.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const luminance=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
  return {'--bg':color(level),'--surface':color(light?level-3:level+4),'--surface2':color(light?level-7:level+8),
    '--ink':light?'#25232b':'#f0ece7','--muted':light?'#585260':'#bbb7b3','--line':color(light?level-19:level+17),
    '--accent':t.accent,'--accent-ink':light?`color-mix(in srgb, ${t.accent} 65%, #25232b)`:t.accent,'--accent-bright':t.accent,'--text':light?'#25232b':'#f0ece7','--on-accent':luminance>.179?'#111111':'#ffffff',
    '--pink':light?'#a62d4e':'#ffb3b0','--lavender':light?'#6e438c':'#cfc0e8','--info':light?'#17678e':'#79dfff',
    '--glow':t.glow,'--reading':fontPresets[t.font].reading,'--sans':t.font==='system'?'"Yu Gothic UI", Meiryo, sans-serif':'"Zen Kaku Gothic New", "Yu Gothic UI", Meiryo, sans-serif'};
}
export function applyTheme(value) {
  const theme = normalizeTheme(value), root = document.documentElement;
  for(const [key,val] of Object.entries(themeTokens(theme)))root.style.setProperty(key,val);
  root.dataset.mode=theme.mode;root.style.colorScheme=theme.mode;
  root.dataset.motion = theme.motion ? "on" : "off";
  return theme;
}
