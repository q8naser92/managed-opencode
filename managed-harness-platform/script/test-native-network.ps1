$ErrorActionPreference='Stop'
$platformRoot=Split-Path -Parent $PSScriptRoot
$output=Join-Path $platformRoot 'test-results\native-network-tests.exe'
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
& $compiler /nologo /target:exe /platform:x64 ("/out:"+$output) (Join-Path $platformRoot 'native\NetworkAddress.cs') (Join-Path $platformRoot 'test\NativeNetworkTests.cs')
if($LASTEXITCODE -ne 0){throw 'Native network test compilation failed'}
& $output
if($LASTEXITCODE -ne 0){throw 'Native network test failed'}
