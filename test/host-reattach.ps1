param([string]$BuildDirectory='dist-recovery')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskProfile=Join-Path $taskRoot ('.test-data\host-reattach-'+[guid]::NewGuid().ToString('N'))
$taskExe=Join-Path $taskRoot "$BuildDirectory\AtlasBrowser.exe"
$taskPrevious=@{}
foreach($taskKey in @('ATLAS_PROFILE','AI_WORKSPACE_DATA','GPT_ATLAS_DESKTOP_SYNC')){$taskPrevious[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')}
$taskApp=$null;$taskBackend=$null
function Wait-Condition([scriptblock]$Condition,[string]$Message){
 $taskDeadline=(Get-Date).AddSeconds(35)
 do {if(& $Condition){return};Start-Sleep -Milliseconds 250}while((Get-Date)-lt $taskDeadline)
 throw $Message
}
try{
 $env:ATLAS_PROFILE=$taskProfile;$env:AI_WORKSPACE_DATA=Join-Path $taskProfile 'data';$env:GPT_ATLAS_DESKTOP_SYNC='0'
 $taskApp=Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $taskLog=Join-Path $taskProfile 'lifecycle.log'
 Wait-Condition { (Test-Path -LiteralPath $taskLog) -and ((Get-Content -LiteralPath $taskLog -Raw) -match 'ui.navigation-completed success=True') } 'Fixture did not start'
 $taskRecord=Get-Content -LiteralPath (Join-Path $taskProfile 'backend-session.json') -Raw | ConvertFrom-Json
 $taskBackend=Get-Process -Id $taskRecord.Pid
 $taskUri=[Uri]$taskRecord.Url
 $taskBase=$taskUri.GetLeftPart([UriPartial]::Authority)
 $taskHeaders=@{'x-workspace-token'=$taskUri.Fragment.TrimStart('#')}
 Invoke-RestMethod -Uri "$taskBase/api/preferences" -Method Post -Headers $taskHeaders -ContentType 'application/json' -Body '{"windowId":"main","drafts":{"recovery-fixture":"KEEP UNSENT DRAFT"}}' | Out-Null
 $taskBefore=(Get-Content -LiteralPath (Join-Path $taskProfile 'data\workspace.json') -Raw | ConvertFrom-Json)
 # Only the host launched with this fresh fixture profile is stopped. AI is never invoked.
 Stop-Process -Id $taskApp.Id
 Wait-Condition { $taskApp.HasExited } 'Fixture host did not exit'
 if($taskBackend.HasExited){throw 'Backend did not survive host loss'}
 $taskApp=Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 Wait-Condition { (Get-Content -LiteralPath $taskLog -Raw) -match 'backend.reattach' } 'Host did not reattach'
 Wait-Condition { ([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'ui.navigation-completed success=True')).Count-ge 2 } 'Reattached UI did not load'
 $taskAfter=(Get-Content -LiteralPath (Join-Path $taskProfile 'data\workspace.json') -Raw | ConvertFrom-Json)
 if($taskBackend.HasExited){throw 'Original backend exited'}
 if(([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'backend.start pid=')).Count-ne 1){throw 'Duplicate backend started'}
 if($taskAfter.ui.drafts.'recovery-fixture' -ne 'KEEP UNSENT DRAFT'){throw 'Unsent draft changed'}
 if($taskBefore.tasks.Count-ne $taskAfter.tasks.Count){throw 'Task count changed'}
 # A live service with rejected authentication must not be replaced by a second writer.
 Stop-Process -Id $taskApp.Id
 Wait-Condition { $taskApp.HasExited } 'Reattached fixture did not exit'
 $taskRecord.Url=$taskBase+'/#'+('0'*64)
 $taskRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskProfile 'backend-session.json') -Encoding UTF8
 $taskApp=Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 Wait-Condition { (Get-Content -LiteralPath $taskLog -Raw) -match 'boot.failed' } 'Rejected reconnect did not show recovery state'
 if($taskBackend.HasExited){throw 'Rejected reconnect stopped original backend'}
 if(([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'backend.start pid=')).Count-ne 1){throw 'Rejected reconnect duplicated backend'}
 Write-Output 'PASS: host loss -> same backend and UI restored; unsent draft retained; invalid reconnect does not stop or duplicate backend.'
}finally{
 if($taskApp-and !$taskApp.HasExited){Stop-Process -Id $taskApp.Id}
 if($taskBackend-and !$taskBackend.HasExited){Stop-Process -Id $taskBackend.Id}
 foreach($taskKey in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskKey,$taskPrevious[$taskKey],'Process')}
}
