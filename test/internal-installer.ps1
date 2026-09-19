param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskFixture=Join-Path $taskRoot ('.test-data\installer-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskFixture -Force | Out-Null
$taskAssembly=[Reflection.Assembly]::LoadFile((Resolve-Path -LiteralPath $Installer).Path)
$taskType=$taskAssembly.GetType('InternalSetup')
$taskFlags=[Reflection.BindingFlags]'NonPublic,Static'
$taskInstall=Join-Path $taskFixture 'installed'
$taskRegistry='Software\AtlasBrowserInstallerTests\'+[guid]::NewGuid().ToString('N')
# Redirect every mutation before invoking the real install/update/uninstall methods.
foreach($taskPair in @(@('InstallRoot',$taskInstall),@('RegistryPath',$taskRegistry),@('MenuShortcut',(Join-Path $taskFixture 'menu.lnk')),@('DesktopShortcut',(Join-Path $taskFixture 'desktop.lnk')))){
 $taskType.GetField($taskPair[0],$taskFlags).SetValue($null,$taskPair[1])
 if($taskType.GetField($taskPair[0],$taskFlags).GetValue($null) -ne $taskPair[1]){throw 'Fixture redirection failed'}
}
$taskWork=Join-Path $taskFixture 'work'
New-Item -ItemType Directory -Path $taskWork | Out-Null
Set-Content -LiteralPath (Join-Path $taskWork 'keep.txt') -Value 'User file must survive'
$taskReport=[Action[string]]{param($message)}
try{
 if(-not $taskType.GetMethod('WebViewInstalled',$taskFlags).Invoke($null,@())){throw 'This fixture requires an existing WebView2 runtime; it never installs external prerequisites'}
 $taskMethod=$taskType.GetMethod('Install',$taskFlags)
 $taskMethod.Invoke($null,@([string]$taskWork,'workspace-write',$false,$taskReport)) | Out-Null
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($taskRegistry)
 $taskFirst=$taskKey.GetValue('InstallLocation');$taskKey.Close()
 $taskConfig=Get-Content -LiteralPath (Join-Path $taskFirst 'installation.json') -Raw | ConvertFrom-Json
 if($taskConfig.workFolder -ne $taskWork -or $taskConfig.access -ne 'workspace-write' -or $taskConfig.chromeSync){throw 'Installer configuration mismatch'}
 $taskShell=New-Object -ComObject WScript.Shell
 $taskLink=$taskShell.CreateShortcut((Join-Path $taskFixture 'desktop.lnk'))
 if($taskLink.TargetPath -ne (Join-Path $taskFirst 'dist\AtlasBrowser.exe')){throw 'Shortcut target mismatch'}
 $taskMethod.Invoke($null,@([string]$taskWork,'danger-full-access',$false,$taskReport)) | Out-Null
 $taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($taskRegistry)
 $taskSecond=$taskKey.GetValue('InstallLocation');$taskKey.Close()
 if($taskFirst -eq $taskSecond -or -not(Test-Path -LiteralPath (Join-Path $taskFirst 'dist\AtlasBrowser.exe'))){throw 'Update failed to preserve the previous version'}
 $taskType.GetMethod('Uninstall',$taskFlags).Invoke($null,@()) | Out-Null
 if(Test-Path -LiteralPath $taskInstall){throw 'Installed files remain after uninstall'}
 if(Test-Path -LiteralPath (Join-Path $taskFixture 'desktop.lnk')){throw 'Shortcut remains after uninstall'}
 if(-not(Test-Path -LiteralPath (Join-Path $taskWork 'keep.txt'))){throw 'Uninstall removed a user file'}
 if($null -ne [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($taskRegistry)){throw 'Uninstall registry entry remains'}
 Write-Output 'PASS: actual installer extraction/hash validation, folder/permission configuration, shortcuts, registry, versioned update and uninstall; user files preserved. All destinations isolated.'
}finally{
 [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($taskRegistry,$false)
}
