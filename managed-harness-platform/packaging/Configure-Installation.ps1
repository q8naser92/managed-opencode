#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param([ValidateSet('Client','Server')][string]$Role,[ValidateSet('Configure','Rollback','Commit','Uninstall','Verify')][string]$Mode='Configure',[string]$ConfigFile='',[string]$TransactionId='')
$ErrorActionPreference='Stop'
$base=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ManagedOpenCodeCentral'
$programs=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ManagedOpenCodeCentral'
$data=Join-Path $base $Role
$backup=Join-Path $base ('Installer-'+$Role+'-'+$TransactionId)
$permissions=Join-Path $PSScriptRoot 'Set-InstallationPermissions.ps1'
function Assert-SafePath([string]$Path){$current=[IO.Path]::GetFullPath($Path);while($current){if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'A configuration path contains a reparse point'}};$parent=[IO.Directory]::GetParent($current);if(-not $parent){break};$current=$parent.FullName}}
function Private-Directory([string]$Path){Assert-SafePath $Path;[IO.Directory]::CreateDirectory($Path)|Out-Null;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$admin=New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544';$acl.SetOwner($admin);foreach($id in @('S-1-5-32-544','S-1-5-18')){$sid=New-Object Security.Principal.SecurityIdentifier $id;$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))};Set-Acl -LiteralPath $Path -AclObject $acl}
function Write-Json([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding($false)))}
function Copy-Pem([string]$Source,[string]$Name,[bool]$Required=$false){
  if([string]::IsNullOrWhiteSpace($Source)){if($Required){throw ('A '+$Name+' file is required')};return $null}
  Assert-SafePath $Source;if(-not [IO.File]::Exists($Source)){throw ('Cannot open '+$Name)}
  # ReadAllText recognizes Unicode BOMs. Persist normalized UTF-8 PEM for Bun/OpenSSL.
  $pem=[IO.File]::ReadAllText($Source).Trim([char]0xfeff).Replace("`r`n","`n").Trim()+"`n"
  if($Name -notlike '*-key.pem'){
    if($pem.Contains('PRIVATE KEY')){throw 'A certificate bundle must not contain private keys'}
    $blocks=[regex]::Matches($pem,'-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----')
    if($blocks.Count -eq 0){throw 'No PEM certificates found'}
    foreach($block in $blocks){$cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (,[Convert]::FromBase64String($block.Groups[1].Value));$cert.Dispose()}
  }
  $target=Join-Path $data $Name;[IO.File]::WriteAllText($target,$pem,(New-Object Text.UTF8Encoding($false)));return $target
}
function Server-Command([string[]]$Arguments){
  $executable=Join-Path (Join-Path $programs 'Server') 'managed-server.exe'
  $p=Start-Process -FilePath $executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  try{if(-not $p.WaitForExit(60000)){Stop-Process -Id $p.Id -Force;throw 'Server configuration command timed out'};if($p.ExitCode -ne 0){throw 'Server configuration command failed'}}finally{$p.Dispose()}
}
function Https-Origin([string]$Value){$uri=[Uri]$Value;if(-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment){throw 'Use an HTTPS server address without a path or credentials'};return $uri.GetLeftPart([UriPartial]::Authority)}
function Assert-Transaction {
    Assert-SafePath $backup
    $acl=Get-Acl -LiteralPath $backup
    $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if($owner -notin @('S-1-5-32-544','S-1-5-18') -or -not $acl.AreAccessRulesProtected){throw 'Untrusted installation transaction'}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-32-544','S-1-5-18')){throw 'Untrusted transaction permissions'}}
    foreach($file in @(Get-ChildItem -LiteralPath $backup -Force)){Assert-SafePath $file.FullName}
    $marker=[IO.File]::ReadAllText((Join-Path $backup 'manifest.json')) | ConvertFrom-Json
    if($marker.transaction -ne $TransactionId -or $marker.role -ne $Role){throw 'Installation transaction ownership mismatch'}
    return $marker
}
function Remove-Backup {Assert-SafePath $backup;$expected=[IO.Path]::GetFullPath((Join-Path $base ('Installer-'+$Role+'-'+$TransactionId)));if([IO.Path]::GetFullPath($backup) -ne $expected){throw 'Invalid backup path'};if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Recurse -Force}}
try{
  Assert-SafePath $data
  if($Mode -eq 'Verify'){if($Role -eq 'Server'){Server-Command @('--healthcheck')};exit 0}
  if($Mode -eq 'Uninstall'){if($Role -eq 'Server'){Get-NetFirewallRule -Name ManagedOpenCodeServer -ErrorAction SilentlyContinue | Remove-NetFirewallRule};exit 0}
  if($TransactionId -notmatch '^[a-f0-9]{32}$'){throw 'A unique installation transaction is required'}
  if($Mode -eq 'Commit'){Assert-Transaction | Out-Null;Remove-Backup;exit 0}
  if($Mode -eq 'Rollback'){
    if(Test-Path -LiteralPath (Join-Path $backup 'manifest.json')){
      $manifest=Assert-Transaction
      if($Role -eq 'Server'){Get-Service ManagedOpenCodeServer -ErrorAction SilentlyContinue | Where-Object Status -eq Running | Stop-Service}
      foreach($file in @(Get-ChildItem -LiteralPath $data -File -Force)){Assert-SafePath $file.FullName;if($file.Name -notin $manifest.files){Remove-Item -LiteralPath $file.FullName -Force}}
      foreach($file in $manifest.files){if([IO.Path]::GetFileName($file) -ne $file){throw 'Invalid backup member'};Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $data $file) -Force}
      if($Role -eq 'Server'){
        if($manifest.firewall){Get-NetFirewallRule -Name ManagedOpenCodeServer | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol $manifest.firewall.protocol -LocalPort $manifest.firewall.localPort | Out-Null}
        else{Get-NetFirewallRule -Name ManagedOpenCodeServer -ErrorAction SilentlyContinue | Remove-NetFirewallRule}
      }
      & $permissions -Role $Role
      Remove-Backup
    };exit 0
  }
  if($ConfigFile){Assert-SafePath $ConfigFile;$config=[IO.File]::ReadAllText($ConfigFile) | ConvertFrom-Json}else{$config=$null}
  & $permissions -Role $Role
  if(Test-Path -LiteralPath $backup){throw 'An earlier installation backup needs administrator review'}
  Private-Directory $backup
  $files=@(Get-ChildItem -LiteralPath $data -File -Force | ForEach-Object {Assert-SafePath $_.FullName;Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $backup $_.Name);$_.Name})
  $firewall=$null
  if($Role -eq 'Server'){$rule=Get-NetFirewallRule -Name ManagedOpenCodeServer -ErrorAction SilentlyContinue;if($rule){$filter=$rule | Get-NetFirewallPortFilter;$firewall=@{protocol=$filter.Protocol;localPort=@($filter.LocalPort)}}}
  Write-Json (Join-Path $backup 'manifest.json') @{files=$files;transaction=$TransactionId;role=$Role;firewall=$firewall}
  if($Role -eq 'Client'){
    if($config){$origin=Https-Origin $config.serverOrigin;$ca=Copy-Pem $config.caFile 'gateway-ca.pem';$client=@{serverOrigin=$origin};if($ca){$client.caSha256=(Get-FileHash -LiteralPath $ca -Algorithm SHA256).Hash.ToLowerInvariant()};Write-Json (Join-Path $data 'client.json') $client}
    if(-not(Test-Path -LiteralPath (Join-Path $data 'client.json'))){throw 'A client configuration file with serverOrigin is required for first installation'}
    $existing=[IO.File]::ReadAllText((Join-Path $data 'client.json')) | ConvertFrom-Json
    Https-Origin $existing.serverOrigin | Out-Null
  }else{
    if($config){
      $origin=Https-Origin $config.origin;$port=[int]$config.port;if($port -lt 1 -or $port -gt 65535){throw 'Server port must be 1 through 65535'}
      $probe=New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Any),$port;try{$probe.Start()}finally{$probe.Stop()}
      $cert=Copy-Pem $config.tlsCert 'server-chain.pem' $true;$key=Copy-Pem $config.tlsKey 'server-key.pem' $true;$ca=Copy-Pem $config.caFile 'root.pem'
      $gateway=[Uri]$config.gatewayUrl;if(-not $gateway.IsAbsoluteUri -or $gateway.Scheme -ne 'https' -or $gateway.UserInfo -or $gateway.Fragment){throw 'Gateway URL must use HTTPS'}
      $boot=@{origin=$origin;port=$port;tlsCert=$cert;tlsKey=$key;allowedOrigins=@($gateway.GetLeftPart([UriPartial]::Authority));initialPolicy=@{revision=0;gatewayUrl=$gateway.AbsoluteUri;cloudModels=$false;models=@();tools=@{read='ask';edit='ask';cmd='deny';powershell='deny'};maxCommandSeconds=60;maxSessionSteps=30;localAudit=$true}}
      if($ca){$boot.caFile=$ca}
      if($config.saml){$saml=$config.saml;$boot.saml=@{entryPoint=$saml.entryPoint;idpIssuer=$saml.idpIssuer;idpCert=[IO.File]::ReadAllText((Copy-Pem $saml.idpCert 'idp-cert.pem' $true));entityId=$saml.entityId;signingKey=(Copy-Pem $saml.signingKey 'saml-key.pem' $true);signingCert=(Copy-Pem $saml.signingCert 'saml-cert.pem' $true);adminSubjects=@($saml.adminSubjects)}}
      Write-Json (Join-Path $data 'server.json') $boot
    }
    if(-not(Test-Path -LiteralPath (Join-Path $data 'server.json'))){throw 'A server configuration file is required for first installation'}
    $service=Join-Path (Join-Path $programs 'Server') 'managed-service.exe'
    $server=Join-Path (Join-Path $programs 'Server') 'managed-server.exe'
    if(-not(Test-Path -LiteralPath (Join-Path $data 'vault-key.dpapi'))){& $service init-key;if($LASTEXITCODE -ne 0){throw 'Vault initialization failed'}}
    & $permissions -Role Server
    Server-Command @('--validate')
    if($config.bootstrap){$seed=Join-Path $data 'bootstrap.json';try{Write-Json $seed $config.bootstrap;Server-Command @('--bootstrap',('"'+$seed+'"'))}finally{if(Test-Path -LiteralPath $seed){Remove-Item -LiteralPath $seed -Force}}}
    Server-Command @('--validate-access')
    $boot=[IO.File]::ReadAllText((Join-Path $data 'server.json')) | ConvertFrom-Json
    $rule=Get-NetFirewallRule -Name ManagedOpenCodeServer -ErrorAction SilentlyContinue
    if($rule){$rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $boot.port | Out-Null}
    else{New-NetFirewallRule -Name ManagedOpenCodeServer -DisplayName 'Managed OpenCode management HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $boot.port | Out-Null}
    & sc.exe sidtype ManagedOpenCodeServer unrestricted | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Service identity configuration failed'}
    & sc.exe failure ManagedOpenCodeServer reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Service recovery configuration failed'}
    & sc.exe sdset ManagedOpenCodeServer 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLORC;;;BU)' | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Service access control configuration failed'}
  }
  & $permissions -Role $Role
  Write-Output 'Managed installation configuration completed.'
}catch{
  # Never print configuration values or credentials into MSI logs.
  Write-Error ('Installation configuration failed: '+$_.Exception.GetType().Name) -ErrorAction Continue
  exit 1
}
