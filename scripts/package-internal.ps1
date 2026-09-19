param([string]$NodeVersion='24.21.0')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskCache=Join-Path $taskRoot '.native\installer'
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskNodeZip=Join-Path $taskCache "node-v$NodeVersion-win-x64.zip"
$taskSums=(Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
if($taskSums -is [byte[]]){$taskSums=[Text.Encoding]::UTF8.GetString($taskSums)}
$taskExpected=($taskSums -split "`n" | Where-Object {$_ -match "  node-v$([regex]::Escape($NodeVersion))-win-x64.zip\s*$"}).Split(' ')[0]
if($taskExpected -notmatch '^[a-f0-9]{64}$'){throw 'Node.js checksum not found'}
if(-not(Test-Path -LiteralPath $taskNodeZip)){Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $taskNodeZip}
if((Get-FileHash -LiteralPath $taskNodeZip).Hash.ToLower() -ne $taskExpected){throw 'Node.js checksum mismatch'}
& tar -xf $taskNodeZip -C $taskCache
if($LASTEXITCODE -ne 0){throw 'Node.js extraction failed'}
$taskWebview=Join-Path $taskCache 'MicrosoftEdgeWebview2Setup.exe'
if(-not(Test-Path -LiteralPath $taskWebview)){Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $taskWebview}
$taskSignature=Get-AuthenticodeSignature -LiteralPath $taskWebview
if($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation,'){throw 'WebView2 bootstrapper signature is not valid'}
$taskOutput=@(& (Join-Path $PSScriptRoot 'package-preview.ps1') -BuildDirectory 'dist-internal' -StageOnly)
$taskStage=[string]$taskOutput[-1]
if(-not(Test-Path -LiteralPath (Join-Path $taskStage 'manifest.json'))){throw 'Runtime staging failed'}
$taskRelease=Split-Path -Parent $taskStage
New-Item -ItemType Directory -Force -Path (Join-Path $taskStage 'runtime') | Out-Null
Copy-Item -LiteralPath (Join-Path $taskCache "node-v$NodeVersion-win-x64\node.exe") -Destination (Join-Path $taskStage 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $taskCache "node-v$NodeVersion-win-x64\LICENSE") -Destination (Join-Path $taskStage 'licenses\Node.js-LICENSE.txt')
Copy-Item -LiteralPath $taskWebview -Destination (Join-Path $taskStage 'runtime\MicrosoftEdgeWebview2Setup.exe')
Copy-Item -LiteralPath (Join-Path $taskRoot 'docs\internal-distribution.md') -Destination (Join-Path $taskStage 'はじめに.md')
$taskCompiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskArgs=@('/nologo','/target:winexe','/platform:x64','/optimize+',"/win32icon:$taskRoot\public\assets\atlas-browser.ico",'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll',"/win32manifest:$taskRoot\native\app.manifest")
& $taskCompiler @taskArgs "/out:$taskStage\Uninstall.exe" (Join-Path $taskRoot 'native\InternalSetup.cs')
if($LASTEXITCODE -ne 0){throw 'Uninstaller compilation failed'}
$taskManifest=Get-ChildItem -LiteralPath $taskStage -File -Recurse | Where-Object {$_.FullName -ne (Join-Path $taskStage 'manifest.json')} | ForEach-Object {
 [ordered]@{path=$_.FullName.Substring($taskStage.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}
}
[ordered]@{version='0.4.0-internal';channel='internal';builtAt=(Get-Date).ToUniversalTime().ToString('o');nodeVersion=$NodeVersion;files=@($taskManifest)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskStage 'manifest.json') -Encoding UTF8
& (Join-Path $taskStage 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-package.mjs') $taskStage
if($LASTEXITCODE -ne 0){throw 'Internal payload verification failed'}
$taskZip=Join-Path $taskRelease 'payload.zip'
& tar -a -cf $taskZip -C $taskStage .
if($LASTEXITCODE -ne 0){throw 'Payload archive failed'}
$taskHash=Join-Path $taskRelease 'payload.sha256'
(Get-FileHash -LiteralPath $taskZip).Hash.ToLower() | Set-Content -LiteralPath $taskHash -Encoding ASCII
$taskSetup=Join-Path $taskRelease 'Atlas-Browser-Internal-Setup.exe'
& $taskCompiler @taskArgs "/resource:$taskZip,payload.zip" "/resource:$taskHash,payload.sha256" "/out:$taskSetup" (Join-Path $taskRoot 'native\InternalSetup.cs')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
(Get-FileHash -LiteralPath $taskSetup).Hash.ToLower() | Set-Content -LiteralPath ($taskSetup+'.sha256') -Encoding ASCII
Copy-Item -LiteralPath (Join-Path $taskRoot 'docs\internal-distribution.md') -Destination (Join-Path $taskRelease '社内配布の手順.md')
Write-Output $taskSetup
