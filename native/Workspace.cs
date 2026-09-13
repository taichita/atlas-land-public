using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class Workspace : Form {
 static readonly object lifecycleLock=new object();
 static void Lifecycle(string detail){try{lock(lifecycleLock){Directory.CreateDirectory(profile);string file=Path.Combine(profile,"lifecycle.log");if(File.Exists(file)&&new FileInfo(file).Length>2097152){File.Copy(file,file+".previous",true);File.WriteAllText(file,"");}File.AppendAllText(file,DateTimeOffset.Now.ToString("o")+" pid="+Process.GetCurrentProcess().Id+" "+detail+Environment.NewLine);}}catch{}}
 readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=4000000 };
 bool mediaKeys=true,shortcutCapture=false; string mediaIncrease="V",mediaDecrease="Z";
 readonly Dictionary<string,string> shortcutCommands=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
 readonly Dictionary<string,WebView2> pages=new Dictionary<string,WebView2>();
 static readonly string appDir=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
 // Stable storage identity keeps existing logins and task data.
 static readonly string profile=Environment.GetEnvironmentVariable("ATLAS_PROFILE")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PersonalAIWorkspace");
 static string InstanceSuffix(){if(Environment.GetEnvironmentVariable("ATLAS_PROFILE")==null)return "";using(var hash=System.Security.Cryptography.SHA256.Create())return "-"+BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(profile).ToLowerInvariant()))).Replace("-","").Substring(0,16);}
 static Process backend; static string origin,token; static Task<string> serviceReady; static Session session;
 readonly string windowId; bool uiReady,prepareTwo,disposedViews;
 readonly Stopwatch startupClock=Stopwatch.StartNew(); WebView2 ui; CoreWebView2Environment browsing; string activePage; Rectangle pageBounds; readonly Dictionary<string,Rectangle> browserBounds=new Dictionary<string,Rectangle>(); bool browserVisible=false,exiting=false; int running=0; NotifyIcon tray;
 [STAThread] static void Main(){bool created;using(var signal=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\AtlasLandNewWindow"+InstanceSuffix()))using(var mutex=new Mutex(true,"Local\\PersonalAIWorkspaceDesktop"+InstanceSuffix(),out created)){
  if(!created){signal.Set();return;}Lifecycle("app.start");Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  session=new Session();var wait=ThreadPool.RegisterWaitForSingleObject(signal,(s,t)=>session.DispatchNew(),null,Timeout.Infinite,false);
  Application.Run(session);wait.Unregister(null);Lifecycle("app.message-loop-ended");
 }}
 Workspace(string id){windowId=id;DefaultShortcuts();Text="Atlas Land";Width=1480;Height=950;MinimumSize=new Size(860,620);StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(19,19,19);ForeColor=Color.White;AutoScaleMode=AutoScaleMode.Dpi;
  Controls.Add(new Label { Text="Atlas Land を開いています…",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Yu Gothic",16) });
  string iconFile=Path.Combine(appDir,"public","assets","gpt-atlas.ico");if(File.Exists(iconFile))Icon=new Icon(iconFile);
  tray=new NotifyIcon{Icon=Icon,Text="Atlas Land",Visible=false};tray.DoubleClick+=(s,e)=>Restore();var menu=new ContextMenuStrip();menu.Items.Add("開く",null,(s,e)=>Restore());menu.Items.Add("終了",null,(s,e)=>{if(running>0&&MessageBox.Show("実行中の作業を中断して終了しますか？","Atlas Land",MessageBoxButtons.YesNo)!=DialogResult.Yes)return;exiting=true;Close();});tray.ContextMenuStrip=menu;
  BindShortcuts(this,null);Shown+=async(s,e)=>await Boot();Resize+=(s,e)=>{if(WindowState==FormWindowState.Minimized)HidePages();else LayoutPage();};FormClosing+=OnClosing;
 }
 void Restore(){Show();WindowState=FormWindowState.Normal;Activate();tray.Visible=false;LayoutPage();}
 static async Task<string> StartService(){
  Directory.CreateDirectory(profile);
  string node=Environment.GetEnvironmentVariable("AI_WORKSPACE_NODE");if(String.IsNullOrEmpty(node))node=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe");if(!File.Exists(node))throw new Exception("Node.js が見つかりません。AI_WORKSPACE_NODE を設定してください。");
  var info=new ProcessStartInfo(node,"\""+Path.Combine(appDir,"server","main.mjs")+"\""){WorkingDirectory=appDir,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
  backend=Process.Start(info);var startedBackend=backend;Lifecycle("backend.start pid="+startedBackend.Id);startedBackend.Exited+=(s,e)=>{try{Lifecycle("backend.exit pid="+startedBackend.Id+" code="+startedBackend.ExitCode);}catch{}};startedBackend.EnableRaisingEvents=true;backend.ErrorDataReceived+=(s,e)=>{if(!String.IsNullOrEmpty(e.Data))try{File.AppendAllText(Path.Combine(profile,"host-errors.log"),DateTime.Now.ToString("s")+" "+e.Data+Environment.NewLine);}catch{}};backend.BeginErrorReadLine();
  var lineTask=backend.StandardOutput.ReadLineAsync();if(await Task.WhenAny(lineTask,Task.Delay(20000))!=lineTask)throw new Exception("バックエンドの起動がタイムアウトしました");string line=await lineTask;if(String.IsNullOrEmpty(line))throw new Exception("バックエンドを起動できませんでした。host-errors.log を確認してください。");
  var ready=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);string url=Convert.ToString(ready["url"]);var uri=new Uri(url);origin=uri.GetLeftPart(UriPartial.Authority);token=uri.Fragment.TrimStart('#');return url;
 }
 async Task Boot(){try{
  if(serviceReady==null)serviceReady=StartService();await serviceReady;if(IsDisposed)return;
  string url=origin+"/?window="+Uri.EscapeDataString(windowId)+"#"+token;
  ui=new WebView2{Dock=DockStyle.Fill,DefaultBackgroundColor=BackColor};Controls.Clear();Controls.Add(ui);
  var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(profile,"webview","shared"));browsing=env;var uiOptions=env.CreateCoreWebView2ControllerOptions();uiOptions.ProfileName="Workspace";await ui.EnsureCoreWebView2Async(env,uiOptions);
  ui.CoreWebView2.Settings.AreDevToolsEnabled=true;ui.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;ui.CoreWebView2.Settings.IsStatusBarEnabled=false;
  ui.CoreWebView2.NavigationStarting+=(s,e)=>{Uri dest;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out dest)||dest.GetLeftPart(UriPartial.Authority)!=origin||dest.AbsolutePath!="/"){e.Cancel=true;if(IsWeb(e.Uri))Post(new{type="openUrl",url=e.Uri});}};
  ui.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;if(IsWeb(e.Uri))Post(new{type="openUrl",url=e.Uri});};
  ui.CoreWebView2.ProcessFailed+=(s,e)=>Lifecycle("ui.process-failed "+e.ProcessFailedKind);
  ui.CoreWebView2.NavigationCompleted+=(s,e)=>{if(startupClock.IsRunning){startupClock.Stop();Lifecycle("ui.navigation-completed success="+e.IsSuccess+" readyMs="+startupClock.ElapsedMilliseconds);try{File.WriteAllText(Path.Combine(profile,"startup.json"),json.Serialize(new{readyMs=startupClock.ElapsedMilliseconds,pid=Process.GetCurrentProcess().Id,webViewVersion=env.BrowserVersionString,at=DateTime.UtcNow.ToString("o")}));}catch{}}};
  await ui.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(appDir,"native","media-shortcuts.js")));
  ui.CoreWebView2.DOMContentLoaded+=(s,e)=>MediaSettings(ui);
  BindShortcuts(ui,null);ui.CoreWebView2.WebMessageReceived+=Message;ui.Source=new Uri(url);
 }catch(Exception e){Lifecycle("boot.failed "+e.GetType().FullName);MessageBox.Show(e.Message,"Atlas Land を起動できませんでした");exiting=true;Close();}}
 bool IsWeb(string value){Uri u;return Uri.TryCreate(value,UriKind.Absolute,out u)&&(u.Scheme=="https"||u.Scheme=="http");}
 void Post(object data){if(ui!=null&&ui.CoreWebView2!=null&&!IsDisposed)ui.CoreWebView2.PostWebMessageAsJson(json.Serialize(data));}
 string Str(Dictionary<string,object> d,string key,string fallback=""){return d.ContainsKey(key)?Convert.ToString(d[key]):fallback;}
 int Num(Dictionary<string,object>d,string k){return d.ContainsKey(k)?Convert.ToInt32(d[k]):0;}
 void DefaultShortcuts(){string[,] values={{"Ctrl+T","new-tab"},{"Ctrl+W","close-tab"},{"Ctrl+Shift+T","reopen-tab"},{"Ctrl+Tab","next-tab"},{"Ctrl+Shift+Tab","previous-tab"},{"Ctrl+PageUp","previous-tab-page"},{"Ctrl+PageDown","next-tab-page"},{"Ctrl+Shift+PageUp","move-tab-left"},{"Ctrl+Shift+PageDown","move-tab-right"},{"Ctrl+L","address"},{"Ctrl+Backslash","split"},{"Ctrl+Alt+ArrowLeft","focus-left"},{"Ctrl+Alt+ArrowRight","focus-right"},{"Ctrl+Shift+N","new-task"},{"Ctrl+Enter","send"},{"Ctrl+Shift+B","sidebar"},{"F1","shortcuts"}};for(int i=0;i<values.GetLength(0);i++)shortcutCommands[values[i,0]]=values[i,1];for(int i=1;i<=9;i++)shortcutCommands["Ctrl+"+i]="tab-"+i;}
 string KeyName(Keys key){
  if(key>=Keys.A&&key<=Keys.Z)return key.ToString();if(key>=Keys.D0&&key<=Keys.D9)return ((int)key-(int)Keys.D0).ToString();if(key>=Keys.F1&&key<=Keys.F12)return key.ToString();
  if(key==Keys.Left)return "ArrowLeft";if(key==Keys.Right)return "ArrowRight";if(key==Keys.Up)return "ArrowUp";if(key==Keys.Down)return "ArrowDown";
  if(key==Keys.PageUp)return "PageUp";if(key==Keys.PageDown)return "PageDown";if(key==Keys.Tab)return "Tab";if(key==Keys.Home)return "Home";if(key==Keys.End)return "End";if(key==Keys.Insert)return "Insert";if(key==Keys.Delete)return "Delete";if(key==Keys.Back)return "Backspace";if(key==Keys.Enter)return "Enter";if(key==Keys.Space)return "Space";if(key==Keys.Escape)return "Escape";
  if(key==Keys.OemPipe||key==Keys.OemBackslash)return "Backslash";if(key==Keys.OemMinus)return "-";if(key==Keys.Oemplus)return "=";if(key==Keys.OemOpenBrackets)return "[";if(key==Keys.OemCloseBrackets)return "]";if(key==Keys.OemSemicolon)return ";";if(key==Keys.OemQuotes)return "'";if(key==Keys.Oemcomma)return ",";if(key==Keys.OemPeriod)return ".";if(key==Keys.OemQuestion)return "/";if(key==Keys.Oemtilde)return "`";return null;
 }
 string KeyChord(KeyEventArgs e){string key=KeyName(e.KeyCode);if(String.IsNullOrEmpty(key))return null;return (e.Control?"Ctrl+":"")+(e.Alt?"Alt+":"")+(e.Shift?"Shift+":"")+key;}
 void ConfigureShortcuts(Dictionary<string,object> message){object raw;if(!message.TryGetValue("bindings",out raw))return;var bindings=raw as Dictionary<string,object>;if(bindings==null)return;shortcutCommands.Clear();foreach(var pair in bindings){if(pair.Key=="speed-up"||pair.Key=="speed-down")continue;string chord=Convert.ToString(pair.Value);if(!String.IsNullOrWhiteSpace(chord)&&!shortcutCommands.ContainsKey(chord))shortcutCommands[chord]=pair.Key;}}
 void BindShortcuts(Control view,string id){view.KeyDown+=(s,e)=>{
  if(shortcutCapture)return;string command=null;shortcutCommands.TryGetValue(KeyChord(e)??"",out command);
  if(command==null||ui==null||ui.CoreWebView2==null)return;e.Handled=true;e.SuppressKeyPress=true;
  // The browser blocks during KeyDown. Dispatch after the handler returns.
  BeginInvoke(new Action(()=>{if(IsDisposed)return;ui.Focus();Post(new{type="shortcut",command=command,id=id});}));
 };}
 void MediaSettings(WebView2 page){page.CoreWebView2.PostWebMessageAsJson(json.Serialize(new{channel="gpt-atlas-media-v1",kind="settings",enabled=mediaKeys&&!shortcutCapture,increase=mediaIncrease,decrease=mediaDecrease}));}
 void MediaStep(WebView2 source,CoreWebView2WebMessageReceivedEventArgs e){
  // Public pages get only this narrow media command, never the workspace bridge.
  if(!mediaKeys||!source.Visible||e.WebMessageAsJson.Length>256)return;
  try{var m=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);if(Str(m,"type")!="atlas.mediaStep"||!m.ContainsKey("delta"))return;double delta=Convert.ToDouble(m["delta"]);if(delta!=0.25&&delta!=-0.25)return;string message=json.Serialize(new{channel="gpt-atlas-media-v1",kind="apply",delta=delta});foreach(var page in pages.Values)if(page.Visible)page.CoreWebView2.PostWebMessageAsJson(message);ui.CoreWebView2.PostWebMessageAsJson(message);}catch{}
 }
 async void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e){string requestId=null;try{
  Uri source;if(!Uri.TryCreate(e.Source,UriKind.Absolute,out source)||source.GetLeftPart(UriPartial.Authority)!=origin||source.AbsolutePath!="/")return;
  if(e.WebMessageAsJson.Length<256&&e.WebMessageAsJson.Contains("atlas.mediaStep")){MediaStep(ui,e);return;}
  var m=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);requestId=Str(m,"requestId");string action=Str(m,"action"),id=Str(m,"id");
  if(action=="browser.layout"){browserVisible=m.ContainsKey("visible")&&Convert.ToBoolean(m["visible"]);double viewport=m.ContainsKey("viewportWidth")?Convert.ToDouble(m["viewportWidth"]):ui.Width;double scale=ui.Width/Math.Max(1,viewport);browserBounds.Clear();if(m.ContainsKey("panes")){var rawPanes=m["panes"] as System.Collections.IEnumerable;if(rawPanes!=null)foreach(var rawPane in rawPanes){var pane=rawPane as Dictionary<string,object>;if(pane==null)continue;string paneId=Str(pane,"id");if(String.IsNullOrEmpty(paneId))continue;browserBounds[paneId]=new Rectangle((int)(Num(pane,"x")*scale),(int)(Num(pane,"y")*scale),(int)(Num(pane,"width")*scale),(int)(Num(pane,"height")*scale));}}pageBounds=new Rectangle((int)(Num(m,"x")*scale),(int)(Num(m,"y")*scale),(int)(Num(m,"width")*scale),(int)(Num(m,"height")*scale));LayoutPage();}
  else if(action=="browser.open"){string target=Str(m,"url");if(!IsWeb(target))throw new Exception("http / https のURLを入力してください");var web=await GetPage(id);activePage=id;web.CoreWebView2.Resume();web.CoreWebView2.Navigate(target);LayoutPage();}
  else if(action=="browser.select"){activePage=id;if(pages.ContainsKey(id))pages[id].CoreWebView2.Resume();LayoutPage();}
  else if(action=="browser.focus"&&pages.ContainsKey(id)&&pages[id].Visible)pages[id].Focus();
   else if(action=="window.shortcuts")ConfigureShortcuts(m);
   else if(action=="window.shortcutCapture"){shortcutCapture=m.ContainsKey("enabled")&&Convert.ToBoolean(m["enabled"]);MediaSettings(ui);foreach(var page in pages.Values)MediaSettings(page);}
   else if(action=="browser.mediaKeys"){mediaKeys=!m.ContainsKey("enabled")||Convert.ToBoolean(m["enabled"]);mediaIncrease=Str(m,"increase","V");mediaDecrease=Str(m,"decrease","Z");foreach(var page in pages.Values)MediaSettings(page);MediaSettings(ui);}
  else if(action=="browser.close"){if(pages.ContainsKey(id)){pages[id].Dispose();pages.Remove(id);}browserBounds.Remove(id);if(activePage==id)activePage=null;LayoutPage();}
  else if(action=="browser.suspend"){if(pages.ContainsKey(id)&&id!=activePage){pages[id].Visible=false;await pages[id].CoreWebView2.TrySuspendAsync();Post(new{type="browser.suspended",id=id});}}
  else if(action=="browser.back"&&pages.ContainsKey(id)){if(pages[id].CoreWebView2.CanGoBack)pages[id].CoreWebView2.GoBack();}
  else if(action=="browser.forward"&&pages.ContainsKey(id)){if(pages[id].CoreWebView2.CanGoForward)pages[id].CoreWebView2.GoForward();}
  else if(action=="browser.reload"&&pages.ContainsKey(id))pages[id].CoreWebView2.Reload();
  else if(action=="browser.read"&&pages.ContainsKey(id)){string result=await pages[id].CoreWebView2.ExecuteScriptAsync("(()=>({title:document.title,url:location.href,text:(getSelection().toString()||document.body.innerText).slice(0,40000),links:Array.from(document.querySelectorAll('a[href]')).slice(0,60).map(a=>({text:a.innerText.slice(0,120),url:a.href}))}))()");Post(new{type="response",requestId=requestId,result=json.DeserializeObject(result)});return;}
  else if(action=="browser.speed"&&pages.ContainsKey(id)){double speed=Convert.ToDouble(m["speed"]);if(speed<0.25||speed>8)throw new Exception("速度は0.25〜8倍で指定してください");string speedText=speed.ToString(System.Globalization.CultureInfo.InvariantCulture);string count=await pages[id].CoreWebView2.ExecuteScriptAsync("(()=>{let v=document.querySelectorAll('video,audio');v.forEach(x=>x.playbackRate="+speedText+");return v.length})()");Post(new{type="response",requestId=requestId,result=json.DeserializeObject(count)});return;}
  else if(action=="chooseFolder"){HidePages();using(var picker=new FolderBrowserDialog{Description="作業フォルダ",SelectedPath=Str(m,"path",@"C:\dev"),ShowNewFolderButton=true}){string selected=picker.ShowDialog(this)==DialogResult.OK?picker.SelectedPath:null;Post(new{type="response",requestId=requestId,result=selected});}LayoutPage();return;}
  else if(action=="chooseFile"){HidePages();using(var picker=new OpenFileDialog{Title="Atlasで開くファイル",InitialDirectory=Str(m,"path",@"C:\dev"),Filter="対応ファイル|*.txt;*.md;*.markdown;*.csv;*.tsv;*.json;*.html;*.htm;*.pdf;*.mp4;*.webm;*.mov;*.m4v;*.mp3;*.wav;*.m4a;*.ogg;*.flac;*.png;*.jpg;*.jpeg;*.webp;*.gif;*.svg|すべてのファイル|*.*",CheckFileExists=true,Multiselect=false}){string selected=picker.ShowDialog(this)==DialogResult.OK?picker.FileName:null;Post(new{type="response",requestId=requestId,result=selected});}LayoutPage();return;}
  else if(action=="activity"){running=Num(m,"running");tray.Text=running>0?"Atlas Land · "+running+" 件の作業":"Atlas Land";}
  else if(action=="file.reveal"){
   string target=Str(m,"path");if(String.IsNullOrWhiteSpace(target)||target.IndexOf('"')>=0||target.Any(Char.IsControl)||!Path.IsPathRooted(target)||target.StartsWith(@"\\"))throw new Exception("ローカルのファイルまたはフォルダを指定してください");
   target=Path.GetFullPath(target);bool directory=Directory.Exists(target);if(!directory&&!File.Exists(target))throw new Exception("保存場所が見つかりません: "+target);
   if(directory&&target.Length==3)target=Path.Combine(target,".");
   string args=directory?"\""+target.TrimEnd(Path.DirectorySeparatorChar)+"\"":"/select,\""+target+"\"";
   Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe"),args){UseShellExecute=true});
  }
  else if(action=="window.restore")Restore();
  else if(action=="window.new")session.Open();
  else if(action=="window.dual")session.Dual(this);
  else if(action=="window.ready"){uiReady=true;if(prepareTwo){prepareTwo=false;Post(new{type="window.twoPanes"});}}
  else if(action=="window.focusUI")ui.Focus();
  else if(action=="app.exit"){exiting=true;Close();}
  Post(new{type="response",requestId=requestId,result=true});
 }catch(Exception error){Post(new{type="response",requestId=requestId,error=error.Message});}}
 async Task<WebView2> GetPage(string id){if(pages.ContainsKey(id))return pages[id];if(browsing==null)browsing=await CoreWebView2Environment.CreateAsync(null,Path.Combine(profile,"webview","browsing"));
  var page=new WebView2{Visible=false,DefaultBackgroundColor=Color.White};Controls.Add(page);pages.Add(id,page);var pageOptions=browsing.CreateCoreWebView2ControllerOptions();pageOptions.ProfileName="Browsing";await page.EnsureCoreWebView2Async(browsing,pageOptions);
  // Let the browser show its own save/update prompt; credentials stay in its profile.
  page.CoreWebView2.Settings.IsPasswordAutosaveEnabled=true;
  BindShortcuts(page,id);page.Enter+=(s,e)=>Post(new{type="browser.focused",id=id});page.CoreWebView2.WebMessageReceived+=(s,e)=>MediaStep(page,e);
  await page.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(appDir,"native","media-shortcuts.js")));
  page.CoreWebView2.DOMContentLoaded+=(s,e)=>MediaSettings(page);
  page.CoreWebView2.NavigationStarting+=(s,e)=>{if(!IsWeb(e.Uri)&&e.Uri!="about:blank"){e.Cancel=true;Post(new{type="browser.error",id=id,error="この種類のリンクは未対応です: "+new Uri(e.Uri).Scheme});}};
  Action state=()=>Post(new{type="browser.state",id=id,url=page.CoreWebView2.Source,title=page.CoreWebView2.DocumentTitle,back=page.CoreWebView2.CanGoBack,forward=page.CoreWebView2.CanGoForward});
  page.CoreWebView2.DocumentTitleChanged+=(s,e)=>state();page.CoreWebView2.SourceChanged+=(s,e)=>state();page.CoreWebView2.HistoryChanged+=(s,e)=>state();page.CoreWebView2.NavigationCompleted+=(s,e)=>{state();if(!e.IsSuccess)Post(new{type="browser.error",id=id,error="ページを読み込めませんでした: "+e.WebErrorStatus.ToString()});};
  page.CoreWebView2.NewWindowRequested+=async(s,e)=>{e.Handled=true;if(!IsWeb(e.Uri))return;using(var defer=e.GetDeferral()){string child=(id.Contains(":")?id.Substring(0,id.IndexOf(":")+1):"")+"web-"+Guid.NewGuid().ToString("N");try{var popup=await GetPage(child);e.NewWindow=popup.CoreWebView2;activePage=child;Post(new{type="browser.created",id=child,url=e.Uri,title="新しいタブ"});LayoutPage();}catch(Exception err){Post(new{type="browser.error",id=id,error=err.Message});}}};
  page.CoreWebView2.ProcessFailed+=(s,e)=>Post(new{type="browser.error",id=id,error="Webページの処理が終了しました。再読込してください: "+e.ProcessFailedKind});
  return page;
 }
 void HidePages(){foreach(var p in pages.Values)p.Visible=false;}
 void LayoutPage(){foreach(var pair in pages){Rectangle bounds=Rectangle.Empty;if(browserVisible&&WindowState!=FormWindowState.Minimized){if(browserBounds.Count>0)browserBounds.TryGetValue(pair.Key,out bounds);else if(pair.Key==activePage)bounds=pageBounds;}var p=pair.Value;bool visible=bounds.Width>0&&bounds.Height>0;if(visible){if(p.Bounds!=bounds)p.Bounds=bounds;if(!p.Visible){p.Visible=true;p.BringToFront();}}else if(p.Visible)p.Visible=false;}}
 void OnClosing(object sender,FormClosingEventArgs e){
  if(disposedViews)return;
  Lifecycle("window.closing id="+windowId+" reason="+e.CloseReason+" exiting="+exiting+" running="+running);
  if(!exiting&&running>0&&session.Count==1){e.Cancel=true;Hide();tray.Visible=true;return;}
  if(!exiting&&ui!=null&&ui.CoreWebView2!=null){e.Cancel=true;Post(new{type="app.closing"});return;}
  session.SavePosition(this);disposedViews=true;tray.Dispose();foreach(var p in pages.Values)p.Dispose();if(ui!=null)ui.Dispose();
 }
 public class Placement { public int X,Y,Width,Height; public bool Maximized; }
 public class WindowSettings { public int Count=1; public Dictionary<string,Placement> Positions=new Dictionary<string,Placement>(); }
 class Session : ApplicationContext {
  readonly List<Workspace> windows=new List<Workspace>(); readonly Control dispatcher=new Control();
  readonly string settingsFile=Path.Combine(profile,"windows.json"); readonly JavaScriptSerializer serializer=new JavaScriptSerializer();
  WindowSettings settings=new WindowSettings(); bool shuttingDown=false,restoring=true;
  public int Count{get{return windows.Count;}}
  public Session(){var handle=dispatcher.Handle;try{if(File.Exists(settingsFile))settings=serializer.Deserialize<WindowSettings>(File.ReadAllText(settingsFile));}catch{settings=new WindowSettings();}
   settings=settings??new WindowSettings();settings.Positions=settings.Positions??new Dictionary<string,Placement>();int count=Math.Max(1,Math.Min(8,settings.Count));
   for(int i=0;i<count;i++)Open();restoring=false;
  }
  public void DispatchNew(){try{if(!shuttingDown&&!dispatcher.IsDisposed)dispatcher.BeginInvoke(new Action(()=>{if(!shuttingDown)Open();}));}catch{}}
  public Workspace Open(){
   int n=1;while(windows.Any(existing=>existing.windowId==(n==1?"main":"window-"+n)))n++;
   var w=new Workspace(n==1?"main":"window-"+n);Placement p;
   if(settings.Positions.TryGetValue(w.windowId,out p)&&p.Width>=860&&p.Height>=620){var rect=new Rectangle(p.X,p.Y,p.Width,p.Height);if(Screen.AllScreens.Any(s=>Rectangle.Intersect(s.WorkingArea,rect).Width>=100&&Rectangle.Intersect(s.WorkingArea,rect).Height>=100)){w.StartPosition=FormStartPosition.Manual;w.Bounds=rect;if(p.Maximized)w.WindowState=FormWindowState.Maximized;}}
   else if(n>1){var screens=Screen.AllScreens.OrderBy(s=>s.Bounds.Left).ThenBy(s=>s.Bounds.Top).ToArray();w.StartPosition=FormStartPosition.Manual;w.Bounds=screens[(n-1)%screens.Length].WorkingArea;}
   windows.Add(w);w.FormClosed+=Closed;w.ResizeEnd+=(s,e)=>SavePosition(w);w.Show();
   if(!restoring){settings.Count=windows.Count;SavePosition(w);}Lifecycle("window.open id="+w.windowId);return w;
  }
  public void Dual(Workspace source){
   var screens=Screen.AllScreens.OrderBy(s=>s.Bounds.Left).ThenBy(s=>s.Bounds.Top).ToArray();
   if(screens.Length<2)throw new Exception("2台目のモニターが接続されていません");
   var other=windows.FirstOrDefault(w=>w!=source)??Open();var pair=new[]{source,other};
   for(int i=0;i<2;i++){var w=pair[i];w.Show();w.WindowState=FormWindowState.Normal;w.Bounds=screens[i].WorkingArea;w.tray.Visible=false;if(w.uiReady)w.Post(new{type="window.twoPanes"});else w.prepareTwo=true;SavePosition(w);}
   source.Activate();
  }
  public void SavePosition(Workspace w){try{var r=w.WindowState==FormWindowState.Normal?w.Bounds:w.RestoreBounds;settings.Positions[w.windowId]=new Placement{X=r.X,Y=r.Y,Width=r.Width,Height=r.Height,Maximized=w.WindowState==FormWindowState.Maximized};Directory.CreateDirectory(profile);string temp=settingsFile+".tmp";File.WriteAllText(temp,serializer.Serialize(settings));if(File.Exists(settingsFile))File.Replace(temp,settingsFile,settingsFile+".previous");else File.Move(temp,settingsFile);}catch(Exception e){Lifecycle("window.save-failed "+e.GetType().Name);}}
  async void Closed(object sender,FormClosedEventArgs e){windows.Remove((Workspace)sender);if(windows.Count>0)return;shuttingDown=true;
   try{if(backend!=null&&!backend.HasExited){if(!String.IsNullOrEmpty(origin))using(var client=new System.Net.Http.HttpClient()){client.DefaultRequestHeaders.Add("x-workspace-token",token);client.Timeout=TimeSpan.FromSeconds(3);await client.PostAsync(origin+"/api/shutdown",new System.Net.Http.StringContent("{}",Encoding.UTF8,"application/json"));}if(!backend.WaitForExit(1000))backend.Kill();}}
   catch{try{if(backend!=null&&!backend.HasExited)backend.Kill();}catch{}}
   finally{backend=null;dispatcher.Dispose();ExitThread();}
  }
 }
}
