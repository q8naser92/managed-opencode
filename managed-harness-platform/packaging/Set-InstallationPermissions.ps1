#requires -Version 5.1
#requires -RunAsAdministrator
[CmdletBinding()]
param([ValidateSet('Client','Server','Both')][string]$Role = 'Client')
$ErrorActionPreference = 'Stop'

# Resolve machine directories from Windows, not user-controlled environment variables.
$installBase = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'ManagedOpenCodeCentral'
$dataBase = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ManagedOpenCodeCentral'
$adminSid = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'
$systemSid = New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'
$usersSid = New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-545'

function Assert-NoReparsePoint([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Installation path contains a reparse point: $current"
            }
        }
        $parent = [IO.Directory]::GetParent($current)
        if (-not $parent) { break }
        $current = $parent.FullName
    }
}

function Set-ProtectedDirectory([string]$Path, [bool]$Public, $ServiceSid = $null, [bool]$ServiceWrite = $false, [bool]$ResetChildren = $true) {
    Assert-NoReparsePoint $Path
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner($adminSid)
    foreach ($sid in @($adminSid,$systemSid)) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    }
    if ($Public) {
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($usersSid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
    }
    if ($ServiceSid) {
        $rights = if ($ServiceWrite) { 'Modify' } else { 'ReadAndExecute' }
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($ServiceSid,$rights,'ContainerInherit,ObjectInherit','None','Allow')))
    }
    # Reject previously user-controlled trees: replacing an ACL cannot revoke already-open handles.
    # Apply the ACL as part of creation, then validate in case another process won the creation race.
    if (-not (Test-Path -LiteralPath $Path)) { [IO.Directory]::CreateDirectory($Path,$acl) | Out-Null }
    # Windows Program Files inherits TrustedInstaller and CREATOR OWNER.
    # CREATOR OWNER is safe only as inherit-only after verifying ownership and every other writer.
    $trusted=@($adminSid.Value,$systemSid.Value,'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    if($ServiceSid){$trusted+=$ServiceSid.Value}
    $entries = if ($ResetChildren) { @(Get-ChildItem -LiteralPath $Path -Force -Recurse) } else { @() }
    # Permit only read/execute/synchronize (including generic read/execute); reject generic write/all and unknown rights.
    $safe=[int][Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [int][Security.AccessControl.FileSystemRights]::Synchronize -bor [int]::MinValue -bor 0x20000000
    foreach($target in @((Get-Item -LiteralPath $Path -Force))+$entries){
        if($target.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Installation tree contains a reparse point; administrator review is required'}
        $existing=Get-Acl -LiteralPath $target.FullName
        if($existing.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'Installation tree has an untrusted owner; administrator review is required'}
        foreach($rule in $existing.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
            if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and -not ($rule.IdentityReference.Value -eq 'S-1-3-0' -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) -and ([int]$rule.FileSystemRights -band (-bnot $safe))){throw 'Installation tree permits untrusted changes; administrator review is required'}
        }
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
    # Remove explicit grants inherited from an earlier release or from copied files.
    foreach ($entry in $entries) {
        $childAcl = if ($entry.PSIsContainer) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
        $childAcl.SetOwner($adminSid)
        $childAcl.SetAccessRuleProtection($false,$false)
        Set-Acl -LiteralPath $entry.FullName -AclObject $childAcl
    }
}

# Parent updates must preserve a separately protected Server subtree on dual-role hosts.
Set-ProtectedDirectory $installBase $true $null $false $false
Set-ProtectedDirectory $dataBase $true $null $false $false
Set-ProtectedDirectory (Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'ManagedOpenCodeSetup') $false $null $false $false
if ($Role -in @('Client','Both')) {
    Set-ProtectedDirectory (Join-Path $installBase 'Client') $true
    Set-ProtectedDirectory (Join-Path $dataBase 'Client') $true
}
if ($Role -in @('Server','Both')) {
    # The installer must create the service before applying its private storage ACL.
    $serviceSid = (New-Object Security.Principal.NTAccount 'NT SERVICE\ManagedOpenCodeServer').Translate([Security.Principal.SecurityIdentifier])
    Set-ProtectedDirectory (Join-Path $installBase 'Server') $false $serviceSid
    Set-ProtectedDirectory (Join-Path $dataBase 'Server') $false $serviceSid $true
    # The service may write its database, but machine enrollment and key material remain admin-owned.
    foreach ($name in @('server.json','vault-key.dpapi','saml-key.pem','saml-cert.pem','server-key.pem','server-chain.pem','root.pem','idp-cert.pem')) {
        $path=Join-Path (Join-Path $dataBase 'Server') $name
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $acl=New-Object Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true,$false)
        $acl.SetOwner($adminSid)
        foreach ($sid in @($adminSid,$systemSid)) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
        }
        $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($serviceSid,'Read','Allow')))
        Set-Acl -LiteralPath $path -AclObject $acl
    }
}

