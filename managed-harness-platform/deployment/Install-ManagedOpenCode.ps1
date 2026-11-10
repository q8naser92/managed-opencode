#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Client','Server')][string]$Role,
  [Parameter(Mandatory=$true)][string]$ConfigFile,
  [string]$PackageDirectory=(Split-Path -Parent $PSScriptRoot),
  [Parameter(Mandatory=$true)][string]$LogPath
)
$ErrorActionPreference='Stop'
function Quote([string]$Value){if($Value.IndexOfAny([char[]]"`"`r`n`0") -ge 0){throw 'Invalid path'};return '"'+$Value+'"'}
$package=(Resolve-Path -LiteralPath (Join-Path $PackageDirectory ('ManagedOpenCode-'+$Role+'.msi'))).Path
$configuration=(Resolve-Path -LiteralPath $ConfigFile).Path
$log=[IO.Path]::GetFullPath($LogPath)
if(-not(Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($log)))){throw 'Create a protected log directory before deployment'}
$arguments='/i '+(Quote $package)+' /qn /norestart CONFIGFILE='+(Quote $configuration)+' /l*v '+(Quote $log)
$process=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -notin @(0,3010)){throw ('Managed OpenCode installation failed. Exit '+$process.ExitCode+'. Review '+$log)}
Write-Output ('Managed OpenCode '+$Role+' installed. Reboot required: '+($process.ExitCode -eq 3010))
exit $process.ExitCode
