param(
 [string]$Assembly=(Join-Path $PSScriptRoot '..\dist\Setup\ManagedConfigure.exe'),
 [string]$PermissionsScript=(Join-Path $PSScriptRoot '..\packaging\Set-InstallationPermissions.ps1')
)
$ErrorActionPreference='Stop'
$type=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes((Resolve-Path $Assembly))).GetType('ManagedSetup',$true)
$method=$type.GetMethod('ValidateTrustedAcl',[Reflection.BindingFlags]'Static,NonPublic')
$tokens=$null;$errors=$null;$tree=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path $PermissionsScript),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Permission script parse failed'}
# Extract actual validation statements, without executing machine installation or filesystem changes.
$trustedAssignment=$tree.Find({param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq '$trusted'},$true)
$safe=$tree.Find({param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -eq '$safe'},$true)
$owner=$tree.Find({param($a) $a -is [Management.Automation.Language.IfStatementAst] -and $a.Extent.Text.StartsWith('if($existing.GetOwner')},$true)
$rules=$tree.Find({param($a) $a -is [Management.Automation.Language.ForEachStatementAst] -and $a.Variable.Extent.Text -eq '$rule'},$true)
if(-not $trustedAssignment -or -not $safe -or -not $owner -or -not $rules){throw 'Production guard structure changed; update test extraction'}
$guard=[scriptblock]::Create($safe.Extent.Text+"`n"+$owner.Extent.Text+"`n"+$rules.Extent.Text)
$adminSid=New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544';$systemSid=New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'
. ([scriptblock]::Create($trustedAssignment.Extent.Text))
$cases=@(
 @('BA owner TrustedInstaller GA','O:BAG:BAD:P(A;;FA;;;BA)(A;;GA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464)',$true),
 @('Inherited TrustedInstaller GA','O:BAG:BAD:P(A;;FA;;;BA)(A;ID;GA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464)',$true),
 @('Creator Owner no propagate','O:BAG:BAD:P(A;;FA;;;BA)(A;OICINPIO;GA;;;CO)',$true),
 @('Untrusted owner despite safe specials','O:BUG:BAD:P(A;;GA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464)(A;OICIIO;GA;;;CO)',$false),
 @('Creator Owner inheritable effective','O:BAG:BAD:P(A;;FA;;;BA)(A;OICI;GA;;;CO)',$false),
 @('Creator Group inherit-only','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CG)',$false),
 @('Owner Rights inherit-only','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;OW)',$false),
 @('Different service SID','O:BAG:BAD:P(A;;FA;;;BA)(A;;GA;;;S-1-5-80-1-2-3-4-5)',$false),
 @('Creator Owner plus Users create directory','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;0x00000004;;;BU)',$false),
 @('Creator Owner plus Users delete child','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;0x00000040;;;BU)',$false),
 @('Creator Owner plus Users GA','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;GA;;;BU)',$false),
 @('Creator Owner plus Users inherit-only GA','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;OICIIO;GA;;;BU)',$false),
 @('TrustedInstaller owner and writer','O:S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464G:BAD:P(A;;FA;;;BA)(A;;GA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464)',$true),
 @('Creator Owner inherit-only','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;FRFX;;;BU)',$true),
 @('Creator Owner direct','O:BAG:BAD:P(A;;FA;;;BA)(A;;GA;;;CO)',$false),
 @('Creator Owner with Users write','O:BAG:BAD:P(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;GW;;;BU)',$false),
 @('concrete read/execute','O:BAG:BAD:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;FRFX;;;BU)',$true),
 @('system owner generic read','O:SYG:BAD:P(A;;FA;;;BA)(A;;FA;;;SY)(A;;GR;;;BU)',$true),
 @('generic execute','O:BAG:BAD:P(A;;FA;;;BA)(A;;GX;;;BU)',$true),
 @('generic read execute','O:BAG:BAD:P(A;;FA;;;BA)(A;;GRGX;;;BU)',$true),
 @('synchronize','O:BAG:BAD:P(A;;FA;;;BA)(A;;0x00100000;;;BU)',$true),
 @('full control','O:BAG:BAD:P(A;;FA;;;BA)(A;;FA;;;BU)',$false),
 @('generic all','O:BAG:BAD:P(A;;FA;;;BA)(A;;GA;;;BU)',$false),
 @('generic write','O:BAG:BAD:P(A;;FA;;;BA)(A;;GW;;;BU)',$false),
 @('generic read write','O:BAG:BAD:P(A;;FA;;;BA)(A;;GRGW;;;BU)',$false),
 @('delete child','O:BAG:BAD:P(A;;FA;;;BA)(A;;0x00000040;;;BU)',$false),
 @('delete','O:BAG:BAD:P(A;;FA;;;BA)(A;;SD;;;BU)',$false),
 @('write DAC','O:BAG:BAD:P(A;;FA;;;BA)(A;;WD;;;BU)',$false),
 @('write owner','O:BAG:BAD:P(A;;FA;;;BA)(A;;WO;;;BU)',$false),
 @('unknown right','O:BAG:BAD:P(A;;FA;;;BA)(A;;0x01000000;;;BU)',$false),
 @('inherited generic all','O:BAG:BAD:P(A;;FA;;;BA)(A;ID;GA;;;BU)',$false),
 @('inherit-only generic write','O:BAG:BAD:P(A;;FA;;;BA)(A;CIIO;GW;;;BU)',$false),
 @('deny write allow read','O:BAG:BAD:P(D;;GW;;;BU)(A;;FA;;;BA)(A;;FR;;;BU)',$true),
 @('untrusted owner','O:BUG:BAD:P(A;;FA;;;BA)(A;;FA;;;SY)',$false),
 @('null DACL','O:BAG:BAD:NO_ACCESS_CONTROL',$false)
)
for($bit=0;$bit -lt 32;$bit++){$mask=([uint64]1 -shl $bit).ToString('X8');$cases+=,@("bit $bit",('O:BAG:BAD:P(A;;FA;;;BA)(A;;0x'+$mask+';;;BU)'),($bit -in @(0,3,5,7,17,20,29,31)))}
foreach($case in $cases){
 $existing=New-Object Security.AccessControl.DirectorySecurity;$existing.SetSecurityDescriptorSddlForm($case[1]);$before=$existing.Sddl
 $accepted=$true
 try{$method.Invoke($null,[object[]]@([Security.AccessControl.DirectorySecurity]$existing))|Out-Null}catch{$errorObject=$_.Exception;while($errorObject.InnerException){$errorObject=$errorObject.InnerException};if($errorObject -isnot [IO.IOException]){throw};$accepted=$false}
 if($accepted -ne $case[2]){throw ('Native guard failed '+$case[0])}
 if($existing.Sddl -ne $before){throw 'Native guard mutated ACL'}
 $accepted=$true
 try{. $guard}catch{if($_.Exception.Message -notlike 'Installation tree *untrusted*'){throw};$accepted=$false}
 if($accepted -ne $case[2]){throw ('PowerShell guard failed '+$case[0])}
 if($existing.Sddl -ne $before){throw 'PowerShell guard mutated ACL'}
}
@{pass=$true;casesPerGuard=$cases.Count;nativeAndPowerShellAgree=$true;inputsUnchanged=$true;assemblySha256=(Get-FileHash $Assembly).Hash;permissionsScriptSha256=(Get-FileHash $PermissionsScript).Hash}|ConvertTo-Json
