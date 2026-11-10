$ErrorActionPreference='Stop'
$platformRoot=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll ("/out:"+(Join-Path $platformRoot 'test-results\native-engine-job-test.exe')) (Join-Path $platformRoot 'native\EngineJob.cs') (Join-Path $platformRoot 'test\NativeEngineJobTests.cs')
if($LASTEXITCODE -ne 0){throw 'Native job test compilation failed'}
