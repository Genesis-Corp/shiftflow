[CmdletBinding()]
param(
    [string]$TaskName = 'ShiftFlow Humanforce Sync',
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ShiftFlowSync'),
    [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
    [switch]$Enable
)
. (Join-Path $PSScriptRoot 'Sync.Common.ps1')
if ((Get-TimeZone).Id -ne 'W. Australia Standard Time') { throw 'Set the PC timezone to Perth before installing the 04:00 AWST task.' }
Protect-SyncDirectory $StateDirectory
$launcher = Join-Path $PSScriptRoot 'Run-HumanforceSync.ps1'
$engine = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
foreach ($path in @($launcher, $StateDirectory, $NodePath)) { if ($path.Contains('"')) { throw 'Paths cannot contain quotes.' } }
if ($Enable) {
    & $engine -NoProfile -NonInteractive -File $launcher -StateDirectory $StateDirectory -NodePath $NodePath -DryRun -Days 21
    if ($LASTEXITCODE -ne 0) { throw 'Roster preview failed or needs review; task was not enabled.' }
    $status = Get-Content -LiteralPath (Join-Path $StateDirectory 'last-status.json') -Raw | ConvertFrom-Json
    if ($status.status -ne 'ok' -or !$status.dry_run -or $status.session_setup) { throw 'Roster preview did not succeed.' }
}
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -StateDirectory "{1}" -NodePath "{2}"' -f $launcher, $StateDirectory, $NodePath
$action = New-ScheduledTaskAction -Execute $engine -Argument $arguments -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')))
$trigger = New-ScheduledTaskTrigger -Daily -At '04:00'
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 90)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Humanforce CSV sync at 04:00 AWST; review flags retained. Requires this user signed in (screen may be locked).'
$task.Settings.Enabled = $Enable.IsPresent
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Select-Object TaskName, State
Write-Output 'Task registered at 04:00 AWST. The PC must be awake, online and this user signed in. Default installation is disabled.'
