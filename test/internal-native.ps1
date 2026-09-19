param([Parameter(Mandatory=$true)][string]$ExtractedDirectory)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskExtract=(Resolve-Path -LiteralPath $ExtractedDirectory).Path
if(-not $taskExtract.StartsWith((Join-Path $taskRoot '.test-data\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Use an isolated extraction fixture'}
$taskProfile=Join-Path $taskRoot ('.test-data\native-internal-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $taskProfile | Out-Null
$taskKeys=@('ATLAS_PROFILE','AI_WORKSPACE_DATA','GPT_ATLAS_DESKTOP_SYNC','AI_WORKSPACE_NODE','AI_WORKSPACE_CODEX','LOCALAPPDATA','CODEX_HOME')
$taskPrevious=@{};foreach($taskKey in $taskKeys){$taskPrevious[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')}
$taskApp=$null;$taskBackend=$null
try{
 $env:ATLAS_PROFILE=$taskProfile;$env:AI_WORKSPACE_DATA=$null;$env:GPT_ATLAS_DESKTOP_SYNC='0';$env:AI_WORKSPACE_NODE=$null;$env:AI_WORKSPACE_CODEX=$null;$env:LOCALAPPDATA=$taskProfile;$env:CODEX_HOME=Join-Path $taskProfile 'codex'
 $taskApp=Start-Process -FilePath (Join-Path $taskExtract 'dist\AtlasBrowser.exe') -WorkingDirectory $taskExtract -WindowStyle Hidden -PassThru
 $taskLog=Join-Path $taskProfile 'lifecycle.log';$taskDeadline=(Get-Date).AddSeconds(40)
 do{
  if(Test-Path -LiteralPath $taskLog){$taskText=Get-Content -LiteralPath $taskLog -Raw;if($taskText -match 'ui.navigation-completed success=True'){break}}
  if($taskApp.HasExited){throw 'Native fixture exited before the UI loaded'}
  Start-Sleep -Milliseconds 200
 }while((Get-Date) -lt $taskDeadline)
 if($taskText -notmatch 'ui.navigation-completed success=True' -or $taskText -match 'boot.failed'){throw ('Native startup failed: '+$taskText)}
 $taskBackendId=[int]([regex]::Match($taskText,'backend.start pid=(\d+)').Groups[1].Value)
 $taskBackend=Get-Process -Id $taskBackendId
 if($taskBackend.Path -ne (Join-Path $taskExtract 'runtime\node.exe')){throw 'Native host did not use the bundled Node runtime'}
 if(-not(Test-Path -LiteralPath (Join-Path $taskProfile 'data\workspace.json'))){throw 'Native profile data was not isolated'}
 Write-Output 'PASS: extracted native exe loaded its UI with bundled Node, a fresh isolated profile and no Codex installed.'
}finally{
 if($taskApp -and !$taskApp.HasExited){Stop-Process -Id $taskApp.Id}
 if(-not $taskBackend -and (Test-Path -LiteralPath (Join-Path $taskProfile 'lifecycle.log'))){$taskText=Get-Content -LiteralPath (Join-Path $taskProfile 'lifecycle.log') -Raw;$taskMatch=[regex]::Match($taskText,'backend.start pid=(\d+)');if($taskMatch.Success){$taskBackend=Get-Process -Id ([int]$taskMatch.Groups[1].Value) -ErrorAction SilentlyContinue}}
 if($taskBackend -and !$taskBackend.HasExited -and $taskBackend.Path -eq (Join-Path $taskExtract 'runtime\node.exe')){Stop-Process -Id $taskBackend.Id}
 foreach($taskKey in $taskKeys){[Environment]::SetEnvironmentVariable($taskKey,$taskPrevious[$taskKey],'Process')}
}
