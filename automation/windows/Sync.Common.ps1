Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Protect-SyncDirectory([string]$Path) {
    [void](New-Item -ItemType Directory -Path $Path -Force)
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($identity in @($sid, [System.Security.Principal.SecurityIdentifier]'S-1-5-18')) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    # Set only the DACL. Set-Acl on Windows PowerShell can also attempt to
    # apply the SACL and demand SeSecurityPrivilege on an already protected path.
    $accessOnly = New-Object System.Security.AccessControl.DirectorySecurity
    $accessOnly.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access), [Security.AccessControl.AccessControlSections]::Access)
    if ($PSVersionTable.PSEdition -eq 'Core') {
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]$Path, $accessOnly)
    } else {
        [IO.Directory]::SetAccessControl($Path, $accessOnly)
    }
}

function Read-SyncSecret([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
