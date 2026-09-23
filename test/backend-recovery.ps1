param([string]$BuildDirectory='dist-recovery')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskProfile=Join-Path $taskRoot ('.test-data\backend-recovery-'+[guid]::NewGuid().ToString('N'))
$taskPrevious=@{}
foreach($taskKey in @('ATLAS_PROFILE','AI_WORKSPACE_DATA','GPT_ATLAS_DESKTOP_SYNC','AI_WORKSPACE_CODEX','CODEX_HOME')){$taskPrevious[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')}
$taskApp=$null;$taskBackend=$null
function Wait-Condition([scriptblock]$Condition,[string]$Message){$taskDeadline=(Get-Date).AddSeconds(35);do{if(& $Condition){return};Start-Sleep -Milliseconds 250}while((Get-Date)-lt $taskDeadline);throw $Message}
try {
 $env:ATLAS_PROFILE=$taskProfile;$env:AI_WORKSPACE_DATA=Join-Path $taskProfile 'data';$env:GPT_ATLAS_DESKTOP_SYNC='0';$env:AI_WORKSPACE_CODEX=(Get-Command node).Source;$env:CODEX_HOME=Join-Path $taskProfile 'codex'
 $taskApp=Start-Process -FilePath (Join-Path $taskRoot "$BuildDirectory\AtlasBrowser.exe") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $taskLog=Join-Path $taskProfile 'lifecycle.log'
 Wait-Condition {(Test-Path -LiteralPath $taskLog)-and ((Get-Content -LiteralPath $taskLog -Raw)-match 'ui.navigation-completed success=True')} 'Fixture UI did not start'
 $taskRecordFile=Join-Path $taskProfile 'backend-session.json'
 $taskRecord=Get-Content -LiteralPath $taskRecordFile -Raw | ConvertFrom-Json
 $taskBackend=Get-Process -Id $taskRecord.Pid
 $taskUri=[Uri]$taskRecord.Url;$taskBase=$taskUri.GetLeftPart([UriPartial]::Authority);$taskHeaders=@{'x-workspace-token'=$taskUri.Fragment.TrimStart('#')}
 $taskBefore=Invoke-RestMethod -Uri "$taskBase/api/bootstrap" -Headers $taskHeaders
 # Kill only the synthetic profile's backend. No user model is invoked.
 Stop-Process -Id $taskBackend.Id
 Wait-Condition {(Get-Content -LiteralPath $taskLog -Raw)-match 'backend.recovered pid='} 'Backend did not recover'
 $taskAfterRecord=Get-Content -LiteralPath $taskRecordFile -Raw | ConvertFrom-Json
 if($taskAfterRecord.Pid-eq $taskRecord.Pid){throw 'Backend PID did not change'}
 $taskBackend=Get-Process -Id $taskAfterRecord.Pid
 if($taskAfterRecord.Url-ne $taskRecord.Url){throw 'Loopback origin or authentication changed'}
 $taskAfter=Invoke-RestMethod -Uri "$taskBase/api/bootstrap" -Headers $taskHeaders
 if($taskAfter.serviceId-eq $taskBefore.serviceId){throw 'Server instance did not change'}
 if($taskApp.HasExited){throw 'Host exited during backend recovery'}
 if(([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'ui.navigation-completed success=True')).Count-ne 1){throw 'Recovery reloaded the UI'}
 if($taskAfter.tasks.Count-ne $taskBefore.tasks.Count){throw 'Tasks were lost'}
 Write-Output 'PASS: backend restarted on same origin/token; service ID changed; host and loaded WebView kept intact.'
}finally{
 if($taskApp-and !$taskApp.HasExited){Stop-Process -Id $taskApp.Id}
 if(Test-Path -LiteralPath (Join-Path $taskProfile 'backend-session.json')){$taskLast=Get-Content -LiteralPath (Join-Path $taskProfile 'backend-session.json') -Raw | ConvertFrom-Json;$taskBackend=Get-Process -Id $taskLast.Pid -ErrorAction SilentlyContinue}
 if($taskBackend-and !$taskBackend.HasExited){Stop-Process -Id $taskBackend.Id}
 foreach($taskKey in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskKey,$taskPrevious[$taskKey],'Process')}
}
