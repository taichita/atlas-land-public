param([string]$OutputDirectory='dist')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskPackage=Join-Path $taskRoot '.native\webview2'
$taskDist=Join-Path $taskRoot $OutputDirectory
New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
if(-not(Test-Path -LiteralPath $taskPackage)){
 New-Item -ItemType Directory -Path (Join-Path $taskRoot '.native') -Force | Out-Null
 $taskZip=Join-Path $taskRoot '.native\webview2.zip'
 Invoke-WebRequest -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4191.47/microsoft.web.webview2.1.0.4191.47.nupkg' -OutFile $taskZip
 Expand-Archive -LiteralPath $taskZip -DestinationPath $taskPackage
}
$taskCore=Join-Path $taskPackage 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$taskForms=Join-Path $taskPackage 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
Copy-Item -LiteralPath $taskCore,$taskForms -Destination $taskDist
Copy-Item -LiteralPath (Join-Path $taskPackage 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $taskDist
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$taskRoot\public\assets\atlas-browser.ico" "/out:$taskDist\AtlasLand.exe" "/win32manifest:$taskRoot\native\app.manifest" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Net.Http.dll "/reference:$taskCore" "/reference:$taskForms" "$taskRoot\native\Workspace.cs"
if($LASTEXITCODE -ne 0){throw 'C# build failed'}
@'
<?xml version="1.0" encoding="utf-8" ?>
<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>
'@ | Set-Content -LiteralPath (Join-Path $taskDist 'AtlasLand.exe.config') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $taskDist 'AtlasLand.exe') -Destination (Join-Path $taskDist 'AtlasBrowser.exe')
Copy-Item -LiteralPath (Join-Path $taskDist 'AtlasLand.exe.config') -Destination (Join-Path $taskDist 'AtlasBrowser.exe.config')
Write-Output "Built: $taskDist\AtlasBrowser.exe"
