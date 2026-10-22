[CmdletBinding()]
param([string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ShiftFlowSync'))
. (Join-Path $PSScriptRoot 'Sync.Common.ps1')
Protect-SyncDirectory $StateDirectory
$values = @{}
foreach ($name in @('HUMANFORCE_USERNAME', 'HUMANFORCE_PASSWORD', 'SHIFTFLOW_URL', 'AUTOMATION_TOKEN')) {
    $value = Read-Host "$name (SHIFTFLOW_URL must be the deployed HTTPS origin)" -AsSecureString
    if ($value.Length -eq 0) { throw "$name is required." }
    $values[$name] = $value
}
$destination = Join-Path $StateDirectory 'configuration.clixml'
# Windows DPAPI binds these SecureStrings to this Windows account on this PC.
$values | Export-Clixml -LiteralPath $destination
Write-Output 'Encrypted configuration saved. Run the launcher with -DryRun before enabling the task.'
