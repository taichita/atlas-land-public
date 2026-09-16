param([string]$BuildDirectory='dist-next')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskProfile=Join-Path $taskRoot ('.test-data\native-recovery-'+[guid]::NewGuid().ToString('N'))
$taskExe=Join-Path $taskRoot "$BuildDirectory\AtlasLand.exe"
$taskPrevious=@{}
foreach($taskKey in @('ATLAS_PROFILE','AI_WORKSPACE_DATA','GPT_ATLAS_DESKTOP_SYNC')){$taskPrevious[$taskKey]=[Environment]::GetEnvironmentVariable($taskKey,'Process')}
$taskApp=$null;$taskBackend=$null
function Wait-Condition([scriptblock]$Condition,[string]$Message){
 $taskDeadline=(Get-Date).AddSeconds(45)
 do {if(& $Condition){return};Start-Sleep -Milliseconds 250}while((Get-Date)-lt $taskDeadline)
 throw $Message
}
try{
 $env:ATLAS_PROFILE=$taskProfile;$env:AI_WORKSPACE_DATA=Join-Path $taskProfile 'data';$env:GPT_ATLAS_DESKTOP_SYNC='0'
 $taskApp=Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 $taskLog=Join-Path $taskProfile 'lifecycle.log'
 Wait-Condition { (Test-Path -LiteralPath $taskLog) -and ((Get-Content -LiteralPath $taskLog -Raw) -match 'ui.navigation-completed success=True') } 'Fixture UI did not start'
 $taskSecond=Start-Process -FilePath $taskExe -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru
 Wait-Condition { ([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'ui.navigation-completed success=True')).Count-ge 2 } 'Second fixture window did not load'
 $taskText=Get-Content -LiteralPath $taskLog -Raw
 $taskBackendId=[int]([regex]::Match($taskText,'backend.start pid=(\d+)').Groups[1].Value)
 $taskBackend=Get-Process -Id $taskBackendId
 $taskBrowser=Get-CimInstance Win32_Process -Filter "ParentProcessId=$($taskApp.Id)" | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine.Contains($taskProfile) -and $_.CommandLine -notmatch '--type=' }
 if(@($taskBrowser).Count-ne 1){throw 'Expected one isolated fixture browser process'}
 # Only the browser process in the newly created fixture profile may be stopped.
 Stop-Process -Id $taskBrowser.ProcessId
 Wait-Condition { (Get-Content -LiteralPath $taskLog -Raw) -match 'webview.recover' } 'Browser recovery did not start'
 Wait-Condition { @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($taskApp.Id)" | Where-Object {$_.Name-eq 'msedgewebview2.exe' -and $_.CommandLine.Contains($taskProfile) -and $_.CommandLine-notmatch '--type=' -and $_.ProcessId-ne $taskBrowser.ProcessId}).Count-eq 1 } 'Browser process was not recreated'
 Wait-Condition { ([regex]::Matches((Get-Content -LiteralPath $taskLog -Raw),'ui.navigation-completed success=True')).Count-ge 4 } 'Both restored windows did not load'
 if($taskApp.HasExited-or $taskBackend.HasExited){throw 'Recovery stopped the app or AI backend'}
 $taskText=Get-Content -LiteralPath $taskLog -Raw
 if(([regex]::Matches($taskText,'backend.start pid=')).Count-ne 1){throw 'Recovery duplicated the backend'}
 if($taskText-match 'boot.failed|process.exception'){throw 'Recovery reported an application failure'}
 Write-Output 'Native recovery passed: both windows restored; original application and AI backend retained.'
}finally{
 # Fixture-only cleanup. User Atlas processes and profiles are never targeted.
 if($taskApp-and !$taskApp.HasExited){Stop-Process -Id $taskApp.Id}
 if($taskBackend-and !$taskBackend.HasExited){Stop-Process -Id $taskBackend.Id}
 foreach($taskKey in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskKey,$taskPrevious[$taskKey],'Process')}
}
