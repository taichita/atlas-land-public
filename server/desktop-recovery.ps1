param([ValidateSet('inspect','launch')][string]$Action='inspect')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$pkg=Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if(!$pkg){ @{installed=$false;running=$false} | ConvertTo-Json -Compress; exit }
# Match package identity across versions, including an old process during deployment.
$running=@(Get-Process ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object {
  if(!$_.Path){throw 'Could not verify desktop process identity'}
  $_.Path -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$'
}).Count -gt 0
$result=@{installed=$true;running=$running;version=[string]$pkg.Version;healthy=([string]$pkg.Status -eq 'Ok')}
if($Action -eq 'launch' -and !$running){
  if(!$result.healthy){throw 'Codex package is being updated or needs repair'}
  $app=(Get-AppxPackageManifest $pkg).Package.Applications.Application | Where-Object { $_.Executable -match '(^|[/\\])(ChatGPT|Codex)\.exe$' } | Select-Object -First 1
  if(!$app){throw 'Codex desktop entry point was not found'}
  # Shell activation follows the registered current package, never a cached version path.
  Start-Process -FilePath explorer.exe -ArgumentList ('shell:AppsFolder\'+$pkg.PackageFamilyName+'!'+$app.Id) | Out-Null
  $result.launched=$true
}
$result | ConvertTo-Json -Compress
