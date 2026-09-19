param([string]$BuildDirectory='dist-package')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-native.ps1') -OutputDirectory $BuildDirectory
if($LASTEXITCODE -ne 0){throw 'Release build failed'}
$taskVersion=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskTag=Get-Date -Format 'yyyyMMdd-HHmmss'
$taskRelease=Join-Path $taskRoot "releases\$taskTag"
$taskStage=Join-Path $taskRelease 'Atlas-Browser-preview'
New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
function Copy-ReleaseFile([string]$Source,[string]$Relative){
 if((Get-Item -LiteralPath $Source).Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Linked file is not allowed: $Relative"}
 $taskTarget=Join-Path $taskStage $Relative
 New-Item -ItemType Directory -Path (Split-Path -Parent $taskTarget) -Force | Out-Null
 Copy-Item -LiteralPath $Source -Destination $taskTarget
}
# Allowlist only runtime code and dependencies. Never copy the workspace root.
$taskLockPath=Join-Path $taskRoot 'package-lock.json'
$taskModules=@(& node (Join-Path $PSScriptRoot 'production-modules.mjs') $taskLockPath)
if($LASTEXITCODE -ne 0){throw 'Dependency allowlist failed'}
foreach($taskFolder in (@('public','server','licenses')+$taskModules)){
 $taskSource=Join-Path $taskRoot $taskFolder
 foreach($taskFile in Get-ChildItem -LiteralPath $taskSource -File -Recurse){
  $taskRelative=$taskFile.FullName.Substring($taskRoot.Length+1)
  if($taskRelative -eq 'public\assets\icon-prompt.md'){continue}
  if($taskFile.Name -match '^(auth\.json|workspace\.json|\.env.*)$' -or $taskFile.Extension -eq '.log'){throw "Unexpected private file: $taskRelative"}
  Copy-ReleaseFile $taskFile.FullName $taskRelative
 }
}
foreach($taskName in @('AtlasBrowser.exe','AtlasBrowser.exe.config','AtlasLand.exe','AtlasLand.exe.config','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){
 Copy-ReleaseFile (Join-Path $taskRoot "$BuildDirectory\$taskName") "dist\$taskName"
}
Copy-ReleaseFile (Join-Path $taskRoot 'native\media-shortcuts.js') 'native\media-shortcuts.js'
Copy-ReleaseFile (Join-Path $taskRoot 'native\page-translation.js') 'native\page-translation.js'
Copy-ReleaseFile (Join-Path $taskRoot 'scripts\claude-statusline.mjs') 'scripts\claude-statusline.mjs'
Copy-ReleaseFile (Join-Path $taskRoot 'docs\preview-start.md') 'はじめに.md'
Copy-ReleaseFile (Join-Path $taskRoot 'docs\shortcuts-and-local-tools.md') '操作方法.md'
Copy-ReleaseFile (Join-Path $taskRoot 'docs\workplace-review.md') '職場での利用確認.md'
foreach($taskDoc in @('multiple-windows','appearance','quick-notes','bookmarks','vertical-tabs','translation','updates','recovery','personalization')){
 Copy-ReleaseFile (Join-Path $taskRoot "docs\$taskDoc.md") "docs\$taskDoc.md"
}
Copy-ReleaseFile (Join-Path $taskRoot 'node_modules\safer-buffer\LICENSE') 'licenses\safer-buffer-LICENSE.txt'
Copy-ReleaseFile (Join-Path $taskRoot 'package.json') 'package.json'
Copy-ReleaseFile (Join-Path $taskRoot 'package-lock.json') 'package-lock.json'
$taskManifest=Get-ChildItem -LiteralPath $taskStage -File -Recurse | ForEach-Object {
 [ordered]@{path=$_.FullName.Substring($taskStage.Length+1).Replace('\','/');bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()}
}
[ordered]@{version=$taskVersion;builtAt=(Get-Date).ToUniversalTime().ToString('o');files=@($taskManifest)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskStage 'manifest.json') -Encoding UTF8
& node (Join-Path $PSScriptRoot 'verify-package.mjs') $taskStage
if($LASTEXITCODE -ne 0){throw 'Package verification failed'}
$taskZip=Join-Path $taskRelease "Atlas-Browser-preview-$taskVersion-win-x64.zip"
Compress-Archive -LiteralPath $taskStage -DestinationPath $taskZip -CompressionLevel Optimal
(Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash.ToLower() | Set-Content -LiteralPath ($taskZip+'.sha256') -Encoding ASCII
Write-Output $taskZip
