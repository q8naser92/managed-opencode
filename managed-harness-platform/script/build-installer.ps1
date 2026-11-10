$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=([IO.File]::ReadAllText((Join-Path $root 'package.json')) | ConvertFrom-Json).version
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$env:DOTNET_ROOT=Join-Path $root 'tools\dotnet'
$env:DOTNET_ROLL_FORWARD='Major'
New-Item -ItemType Directory -Force -Path (Join-Path $root 'dist\Setup') | Out-Null
Push-Location $root
try{
  & tools/dotnet/dotnet.exe build packaging/CustomActions/CustomActions.csproj -c Release -o dist/CustomActions --nologo
  if($LASTEXITCODE -ne 0){throw 'MSI transaction action build failed'}
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ /define:CONFIGURE /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.ServiceProcess.dll /reference:System.Security.dll ('/win32manifest:'+(Join-Path $root 'native\administrator.manifest')) /out:dist/Setup/ManagedConfigure.exe (Join-Path $root 'native\ManagedSetup.cs') (Join-Path $root 'native\NetworkAddress.cs') (Join-Path $root 'native\Version.cs')
  if($LASTEXITCODE -ne 0){throw 'Configuration GUI build failed'}
  foreach($role in @('Client','Server')){
    $upgrade=if($role -eq 'Client'){'7DC59E9D-42C8-4328-8D59-2CB27851A325'}else{'F12B1A9A-3993-4E55-B592-33D946539567'}
    & tools/wix5/wix.exe build packaging/Product.wxs -arch x64 -d "Role=$role" -d "UpgradeCode=$upgrade" -d "Version=$version" -o "dist/Setup/ManagedOpenCode-$role.msi"
    if($LASTEXITCODE -ne 0){throw ('MSI build failed: '+$role)}
  }
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.ServiceProcess.dll /reference:System.Security.dll ('/win32manifest:'+(Join-Path $root 'native\administrator.manifest')) /resource:dist/Setup/ManagedOpenCode-Client.msi,Client.msi /resource:dist/Setup/ManagedOpenCode-Server.msi,Server.msi /out:dist/Setup/ManagedOpenCode-Setup.exe (Join-Path $root 'native\ManagedSetup.cs') (Join-Path $root 'native\NetworkAddress.cs') (Join-Path $root 'native\Version.cs')
  if($LASTEXITCODE -ne 0){throw 'Setup EXE build failed'}
}finally{Pop-Location}
