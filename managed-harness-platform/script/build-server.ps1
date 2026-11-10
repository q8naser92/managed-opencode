param([string]$BunPath='bun')
$ErrorActionPreference='Stop'
$platformRoot=Split-Path -Parent $PSScriptRoot
$version=([IO.File]::ReadAllText((Join-Path $platformRoot 'package.json')) | ConvertFrom-Json).version
$output=Join-Path $platformRoot 'dist\Server'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$bun=(Get-Command $BunPath -ErrorAction Stop).Source
if((& $bun --version) -ne '1.4.4'){throw 'This release requires Bun 1.4.4'}
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ /reference:System.ServiceProcess.dll /reference:System.Security.dll ("/out:"+(Join-Path $output 'managed-service.exe')) (Join-Path $platformRoot 'native\ManagedService.cs') (Join-Path $platformRoot 'native\EngineJob.cs') (Join-Path $platformRoot 'native\Version.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native service compilation failed' }
Push-Location $platformRoot
try {
    & $bun build ./src/server/index.ts --compile --target=bun-windows-x64-baseline --outfile ./dist/Server/managed-server.exe --windows-version "$version.0" --windows-title "Managed OpenCode Server"
    if ($LASTEXITCODE -ne 0) { throw 'Server compilation failed' }
} finally { Pop-Location }
