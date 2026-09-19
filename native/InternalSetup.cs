using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

// Internal, per-user distribution. Never reads the developer's profile or credentials.
class InternalSetup : Form {
 const string Product="Atlas Browser";
 static readonly string RegistryPath=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AtlasBrowserInternal";
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=16000000};
 static readonly string InstallRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Atlas Browser");
 static readonly string MenuShortcut=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Atlas Browser (社内版).lnk");
 static readonly string DesktopShortcut=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Atlas Browser (社内版).lnk");
 readonly TextBox folder=new TextBox{Width=430};
 readonly ComboBox access=new ComboBox{Width=525,DropDownStyle=ComboBoxStyle.DropDownList};
 readonly CheckBox bookmarks=new CheckBox{Text="Chromeのブックマークを取り込む",AutoSize=true};
 readonly Button install=new Button{Text="インストール",AutoSize=true};
 readonly Label status=new Label{AutoSize=true,MaximumSize=new Size(525,0)};
 bool finished;
 static string Under(string root,string relative){
  string full=Path.GetFullPath(Path.Combine(root,relative));
  if(Path.IsPathRooted(relative)||!full.StartsWith(Path.GetFullPath(root).TrimEnd('\\')+"\\",StringComparison.OrdinalIgnoreCase))throw new Exception("配布ファイルのパスが不正です");
  for(string part=full;part!=null&&part.Length>=Path.GetFullPath(root).Length;part=Path.GetDirectoryName(part))if((File.Exists(part)||Directory.Exists(part))&&(File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0)throw new Exception("リンクされたフォルダにはインストール・削除できません");
  return full;
 }
 static string Hash(Stream stream){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
 static void Extract(string target){
  if(Directory.Exists(target)&&Directory.EnumerateFileSystemEntries(target).Any())throw new Exception("展開先は空のフォルダを指定してください");
  Directory.CreateDirectory(target);
  var assembly=Assembly.GetExecutingAssembly();
  using(var payload=assembly.GetManifestResourceStream("payload.zip")){
   if(payload==null)throw new Exception("このファイルはアンインストール専用です");
   string expected;using(var reader=new StreamReader(assembly.GetManifestResourceStream("payload.sha256")))expected=reader.ReadToEnd().Trim();
   if(Hash(payload)!=expected)throw new Exception("セットアップファイルが破損しています。配布元から取得し直してください");
   payload.Position=0;
   using(var zip=new ZipArchive(payload,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
    if(entry.FullName=="./"||entry.FullName==".")continue;
    string file=Under(target,entry.FullName);if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(file);continue;}
    Directory.CreateDirectory(Path.GetDirectoryName(file));using(var input=entry.Open())using(var output=new FileStream(file,FileMode.CreateNew))input.CopyTo(output);
   }
  }
  var manifest=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(target,"manifest.json")));
  foreach(var item in (System.Collections.IEnumerable)manifest["files"]){
   var f=(Dictionary<string,object>)item;string file=Under(target,Convert.ToString(f["path"]));
   if(new FileInfo(file).Length!=Convert.ToInt64(f["bytes"]))throw new Exception("配布ファイルのサイズが一致しません");
   using(var stream=File.OpenRead(file))if(Hash(stream)!=Convert.ToString(f["sha256"]))throw new Exception("配布ファイルの検証に失敗しました");
  }
 }
 static string Config(string work,string mode,bool chrome){return Json.Serialize(new{channel="internal",workFolder=work,access=mode,chromeSync=chrome});}
 static void Shortcut(string path,string target,string working){
  Type type=Type.GetTypeFromProgID("WScript.Shell");object shell=Activator.CreateInstance(type);
  object link=type.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{path});
  Type t=link.GetType();t.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});
  t.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,link,new object[]{working});
  t.InvokeMember("IconLocation",BindingFlags.SetProperty,null,link,new object[]{target+",0"});t.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
  System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
 }
 static bool WebViewInstalled(){
  string[] roots={@"Software\Microsoft\EdgeUpdate\Clients",@"Software\WOW6432Node\Microsoft\EdgeUpdate\Clients"};
  foreach(var hive in new[]{Registry.CurrentUser,Registry.LocalMachine})foreach(string root in roots)using(var clients=hive.OpenSubKey(root)){
   if(clients==null)continue;foreach(string id in clients.GetSubKeyNames())using(var client=clients.OpenSubKey(id)){
    if(Convert.ToString(client.GetValue("name")).IndexOf("WebView2",StringComparison.OrdinalIgnoreCase)>=0&&Convert.ToString(client.GetValue("pv"))!="0.0.0.0")return true;
   }
  }return false;
 }
 static bool Running(){
  foreach(var p in Process.GetProcesses())using(p)try{string exe=p.MainModule.FileName;if(exe.StartsWith(InstallRoot+"\\",StringComparison.OrdinalIgnoreCase)&&p.Id!=Process.GetCurrentProcess().Id)return true;}catch{}
  return false;
 }
 static void Install(string work,string mode,bool chrome,Action<string> report){
  if(Running())throw new Exception("インストール済みのAtlas Browserで作業を保存し、終了してから再実行してください。AI作業は自動では停止しません。");
  // Versioned directories make an interrupted install harmless to the current version.
  Directory.CreateDirectory(InstallRoot);
  string version="build-"+DateTime.UtcNow.ToString("yyyyMMddHHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8);
  string target=Under(InstallRoot,version);
  report("ファイルを展開・検証しています…");Extract(target);
  File.WriteAllText(Path.Combine(target,"installation.json"),Config(work,mode,chrome),new UTF8Encoding(false));
  if(!WebViewInstalled()){
   report("WebView2を準備しています…（インターネット接続が必要です）");
   using(var process=Process.Start(new ProcessStartInfo(Path.Combine(target,"runtime","MicrosoftEdgeWebview2Setup.exe"),"/silent /install"){UseShellExecute=false,CreateNoWindow=true})){
    process.WaitForExit();if(process.ExitCode!=0&&!WebViewInstalled())throw new Exception("WebView2のインストールに失敗しました。ネットワークまたは会社の端末管理設定を確認してください。");
   }
  }
  string exe=Path.Combine(target,"dist","AtlasBrowser.exe");
  string menu=MenuShortcut;
  string desktop=DesktopShortcut;
  Shortcut(menu,exe,target);Shortcut(desktop,exe,target);
  File.WriteAllText(Path.Combine(target,"installed.json"),Json.Serialize(new{menu,desktop}),new UTF8Encoding(false));
  using(var key=Registry.CurrentUser.CreateSubKey(RegistryPath)){
   key.SetValue("DisplayName","Atlas Browser (社内版)");key.SetValue("DisplayVersion","0.4.0-internal");key.SetValue("InstallLocation",target);
   key.SetValue("DisplayIcon",exe);key.SetValue("UninstallString","\""+Path.Combine(target,"Uninstall.exe")+"\" --uninstall");key.SetValue("NoModify",1);key.SetValue("NoRepair",1);
  }
 }
 static void Uninstall(){
  if(Running())throw new Exception("Atlas Browserを終了してからアンインストールしてください。会話・ログイン情報は削除しません。");
  if(!Directory.Exists(InstallRoot))return;
  foreach(string dir in Directory.GetDirectories(InstallRoot,"build-*")){
   string checkedDir=Under(InstallRoot,Path.GetFileName(dir));if((File.GetAttributes(checkedDir)&FileAttributes.ReparsePoint)!=0)continue;
   string manifest=Path.Combine(checkedDir,"manifest.json");if(!File.Exists(manifest))continue;
   var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(manifest));
   var paths=new List<string>();foreach(var item in (System.Collections.IEnumerable)data["files"])paths.Add(Under(checkedDir,Convert.ToString(((Dictionary<string,object>)item)["path"])));
   paths.AddRange(new[]{manifest,Path.Combine(checkedDir,"installation.json"),Path.Combine(checkedDir,"installed.json")});
   // Delete only listed application files; never recursively delete a user-selected directory.
   foreach(string file in paths)if(File.Exists(file))File.Delete(file);
   var folders=new HashSet<string>();foreach(string file in paths)for(string sub=Path.GetDirectoryName(file);sub!=null&&sub.Length>checkedDir.Length;sub=Path.GetDirectoryName(sub))folders.Add(sub);
   foreach(string sub in folders.OrderByDescending(x=>x.Length))if(Directory.Exists(sub)&&!Directory.EnumerateFileSystemEntries(sub).Any())Directory.Delete(sub);
   if(!Directory.EnumerateFileSystemEntries(checkedDir).Any())Directory.Delete(checkedDir);
  }
  foreach(string file in new[]{MenuShortcut,DesktopShortcut})if(File.Exists(file))File.Delete(file);
  Registry.CurrentUser.DeleteSubKeyTree(RegistryPath,false);
  if(!Directory.EnumerateFileSystemEntries(InstallRoot).Any())Directory.Delete(InstallRoot);
 }
 [STAThread] static int Main(string[] args){
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  try{
   if(args.Length==0&&!Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("payload.zip"))args=new[]{"--uninstall"};
   if(args.Length==2&&args[0]=="--verify-extract"){Extract(Path.GetFullPath(args[1]));return 0;}
   if(args.Length==1&&args[0]=="--uninstall"){
    if(MessageBox.Show("Atlas Browser社内版をアンインストールします。会話・ログイン情報・作業ファイルは残ります。",Product,MessageBoxButtons.OKCancel)!=DialogResult.OK)return 0;
    string temp=Path.Combine(Path.GetTempPath(),"Atlas-Uninstall-"+Guid.NewGuid().ToString("N")+".exe");File.Copy(Application.ExecutablePath,temp);
    Process.Start(new ProcessStartInfo(temp,"--remove"){UseShellExecute=false,CreateNoWindow=true});return 0;
   }
   if(args.Length==1&&args[0]=="--remove"){System.Threading.Thread.Sleep(1200);Uninstall();MessageBox.Show("アンインストールしました。",Product);return 0;}
   Application.Run(new InternalSetup());return 0;
  }catch(Exception e){if(args.Length>0){Console.Error.WriteLine(e.Message);File.WriteAllText(Path.Combine(Path.GetTempPath(),"Atlas-Setup-error.txt"),e.ToString());}else MessageBox.Show(e.Message,Product);return 1;}
 }
 InternalSetup(){
  Text="Atlas Browser 社内用セットアップ";ClientSize=new Size(585,465);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;StartPosition=FormStartPosition.CenterScreen;Font=new Font("Yu Gothic UI",10);
  var layout=new FlowLayoutPanel{Dock=DockStyle.Fill,Padding=new Padding(24),FlowDirection=FlowDirection.TopDown,WrapContents=false};Controls.Add(layout);
  layout.Controls.Add(new Label{Text="Atlas Browser",Font=new Font("Georgia",24),AutoSize=true});
  layout.Controls.Add(new Label{Text="社内版 · 各自のAIアカウントで利用します",AutoSize=true,Margin=new Padding(0,6,0,18)});
  layout.Controls.Add(new Label{Text="新しい案件の作業フォルダ",AutoSize=true});
  folder.Text=Directory.Exists(@"C:\dev")?@"C:\dev":Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"Atlas");
  var row=new FlowLayoutPanel{Width=535,Height=40};row.Controls.Add(folder);var browse=new Button{Text="選択",Width=70};browse.Click+=(s,e)=>{using(var dialog=new FolderBrowserDialog{SelectedPath=folder.Text})if(dialog.ShowDialog()==DialogResult.OK)folder.Text=dialog.SelectedPath;};row.Controls.Add(browse);layout.Controls.Add(row);
  layout.Controls.Add(new Label{Text="AIの権限（新しい案件に適用）",AutoSize=true});
  access.Items.AddRange(new object[]{"通常 · PC全体の操作を許可（確認なし）","作業フォルダ内の編集 · 範囲外は確認","読み取りのみ · 変更は確認"});access.SelectedIndex=0;layout.Controls.Add(access);
  layout.Controls.Add(new Label{Text="通常モードでは、AIが作業フォルダ外のファイル操作やコマンドも実行できます。",MaximumSize=new Size(525,0),AutoSize=true,Margin=new Padding(0,6,0,10)});
  layout.Controls.Add(bookmarks);
  layout.Controls.Add(new Label{Text="保存済みの設定は維持します。権限はアプリの「設定と接続」から変更できます。",MaximumSize=new Size(525,0),AutoSize=true,Margin=new Padding(0,8,0,12)});
  layout.Controls.Add(install);layout.Controls.Add(status);
  install.Click+=async(s,e)=>{
   if(finished){Close();return;}
   try{string work=Path.GetFullPath(folder.Text);Directory.CreateDirectory(work);string mode=new[]{"danger-full-access","workspace-write","read-only"}[access.SelectedIndex];bool chrome=bookmarks.Checked;
    install.Enabled=false;folder.Enabled=false;access.Enabled=false;bookmarks.Enabled=false;browse.Enabled=false;ControlBox=false;
    await System.Threading.Tasks.Task.Run(()=>Install(work,mode,chrome,text=>BeginInvoke(new Action(()=>status.Text=text))));
    status.Text="インストールしました。デスクトップの「Atlas Browser (社内版)」から開けます。";install.Text="閉じる";finished=true;ControlBox=true;install.Enabled=true;
   }catch(Exception error){status.Text=error.Message;ControlBox=true;install.Enabled=true;folder.Enabled=true;access.Enabled=true;bookmarks.Enabled=true;browse.Enabled=true;}
  };
 }
}
