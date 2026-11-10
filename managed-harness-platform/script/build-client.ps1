param([string]$ForkRoot=(Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'managed-opencode-fork'))
$ErrorActionPreference='Stop'
$platformRoot=Split-Path -Parent $PSScriptRoot
$output=Join-Path $platformRoot 'dist\Client'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.dll /reference:System.Web.Extensions.dll ("/out:"+(Join-Path $output 'ManagedOpenCode.exe')) (Join-Path $platformRoot 'native\ManagedClient.cs') (Join-Path $platformRoot 'native\EngineJob.cs') (Join-Path $platformRoot 'native\NetworkAddress.cs') (Join-Path $platformRoot 'native\Version.cs')
if($LASTEXITCODE -ne 0){throw 'Client compilation failed'}
Copy-Item -LiteralPath (Join-Path $ForkRoot 'packages\cli\dist\cli-windows-x64-baseline\bin\opencode.exe') -Destination (Join-Path $output 'opencode-engine.exe') -Force
