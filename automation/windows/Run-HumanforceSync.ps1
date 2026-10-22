[CmdletBinding()]
param(
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'ShiftFlowSync'),
    [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
    [ValidateRange(1,60)][int]$Days = 21,
    [switch]$DryRun,
    [switch]$PreflightOnly
)
. (Join-Path $PSScriptRoot 'Sync.Common.ps1')
Protect-SyncDirectory $StateDirectory
$logDirectory = Join-Path $StateDirectory 'logs'
[void](New-Item -ItemType Directory -Path $logDirectory -Force)
$logPath = Join-Path $logDirectory ((Get-Date -Format 'yyyy-MM-dd') + '.log')
$statusPath = Join-Path $StateDirectory 'last-status.json'
$lock = $null
$saved = @{}
$secrets = @{}
$code = 1
try {
    try { $lock = [IO.File]::Open((Join-Path $StateDirectory 'sync.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { Write-Output 'A sync is already running.'; exit 3 }
    Get-ChildItem -LiteralPath $logDirectory -Filter '*.log' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item -Force
    $configPath = Join-Path $StateDirectory 'configuration.clixml'
    if (!(Test-Path -LiteralPath $configPath)) { throw 'Encrypted configuration missing. Run Set-SyncConfiguration.ps1 as this Windows user.' }
    $config = Import-Clixml -LiteralPath $configPath
    foreach ($name in @('HUMANFORCE_USERNAME','HUMANFORCE_PASSWORD','SHIFTFLOW_URL','AUTOMATION_TOKEN','DRY_RUN','MAX_DAYS_AHEAD','TARGET_DATE_OFFSET_DAYS','PREFLIGHT_ONLY')) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    foreach ($name in @('HUMANFORCE_USERNAME','HUMANFORCE_PASSWORD','SHIFTFLOW_URL','AUTOMATION_TOKEN')) {
        if (!$config.ContainsKey($name) -or $config[$name] -isnot [Security.SecureString]) { throw 'Invalid encrypted configuration.' }
        $secrets[$name] = Read-SyncSecret $config[$name]
        [Environment]::SetEnvironmentVariable($name, $secrets[$name], 'Process')
    }
    $env:DRY_RUN = $DryRun.IsPresent.ToString().ToLowerInvariant()
    $env:PREFLIGHT_ONLY = $PreflightOnly.IsPresent.ToString().ToLowerInvariant()
    $env:MAX_DAYS_AHEAD = [string]$Days
    $env:TARGET_DATE_OFFSET_DAYS = '0'
    $entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../humanforce-sync.mjs'))
    & $NodePath $entry 2>&1 | ForEach-Object {
        $line = [string]$_
        foreach ($secret in $secrets.Values) { if ($secret) { $line = $line.Replace($secret, '[REDACTED]') } }
        Add-Content -LiteralPath $logPath -Value $line
        Write-Output $line
    }
    $code = $LASTEXITCODE
} catch {
    $message = 'Launcher failed: ' + $_.Exception.Message
    foreach ($secret in $secrets.Values) { if ($secret) { $message = $message.Replace($secret, '[REDACTED]') } }
    Add-Content -LiteralPath $logPath -Value $message
    Write-Output $message
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    if ($lock) {
        @{ finished_at = [DateTime]::UtcNow.ToString('o'); exit_code = $code; dry_run = $DryRun.IsPresent;
           status = $(if ($code -eq 0) {'ok'} elseif ($code -eq 2) {'needs_review'} else {'failed'}) } |
            ConvertTo-Json | Set-Content -LiteralPath $statusPath
        $lock.Dispose()
    }
    $secrets.Clear()
}
exit $code
