# Local Windows smoke test. Uses fake credentials and a mocked network response.
[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'Sync.Common.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('shiftflow-launcher-test-' + [guid]::NewGuid().ToString('N'))
$originalOptions = $env:NODE_OPTIONS
$originalModules = $env:PSModulePath
$engine = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$launcher = Join-Path $PSScriptRoot 'Run-HumanforceSync.ps1'
try {
    Protect-SyncDirectory $testRoot
    # Reproduce an incompatible Security module ahead of the engine's own
    # modules, as can happen when launched from another PowerShell runtime.
    $shadowModule = Join-Path $testRoot 'modules/Microsoft.PowerShell.Security'
    [void](New-Item -ItemType Directory -Path $shadowModule -Force)
    "@{ModuleVersion='99.0.0';RootModule='Unavailable.Security.dll';CmdletsToExport=@('Get-Acl','ConvertTo-SecureString')}" |
        Set-Content -LiteralPath (Join-Path $shadowModule 'Microsoft.PowerShell.Security.psd1')
    $env:PSModulePath = (Join-Path $testRoot 'modules') + ';' + $originalModules
    & $engine -NoProfile -NonInteractive -File $launcher -StateDirectory $testRoot | Out-Null
    if ($LASTEXITCODE -ne 1) { throw 'Missing configuration did not fail closed.' }
    $fakeToken = 'fake-token-for-launcher-test'
    $values = @{ HUMANFORCE_USERNAME='fake-user'; HUMANFORCE_PASSWORD='fake-password'; SHIFTFLOW_URL='https://test.example'; AUTOMATION_TOKEN=$fakeToken }
    $encrypted = @{}
    foreach ($name in $values.Keys) { $encrypted[$name] = ConvertTo-SecureString $values[$name] -AsPlainText -Force }
    $encrypted | Export-Clixml -LiteralPath (Join-Path $testRoot 'configuration.clixml')
    $mock = Join-Path $testRoot 'mock-network.mjs'
    @'
console.log(process.env.AUTOMATION_TOKEN);
console.log(process.env.HUMANFORCE_PASSWORD);
globalThis.fetch = async () => new Response(JSON.stringify({protocol:'humanforce-safe-v1',ready:true}));
'@ | Set-Content -LiteralPath $mock
    $env:NODE_OPTIONS = '--import="' + ([uri]$mock).AbsoluteUri + '"'
    & $engine -NoProfile -NonInteractive -File $launcher -StateDirectory $testRoot -PreflightOnly | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'DPAPI configuration / preflight test failed.' }
    $logs = Get-Content -LiteralPath (Join-Path $testRoot ('logs/' + (Get-Date -Format 'yyyy-MM-dd') + '.log')) -Raw
    if ($logs.Contains($fakeToken) -or $logs.Contains('fake-password') -or !$logs.Contains('[REDACTED]')) { throw 'Log redaction failed.' }
    $status = Get-Content -LiteralPath (Join-Path $testRoot 'last-status.json') -Raw | ConvertFrom-Json
    if ($status.status -ne 'ok') { throw 'Successful preflight status not recorded.' }
    Write-Output 'Windows launcher checks passed: conflicting module path, missing configuration, DPAPI round trip, preflight and secret redaction.'
} finally {
    $env:NODE_OPTIONS = $originalOptions
    $env:PSModulePath = $originalModules
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
