# Timer-triggered entry point for the AVD hibernate watchdog.
#
# Behaviour is NOT implemented here: this file validates settings, calls the single-source tool script
# (lib/Invoke-AvdHibernateWatchdog.ps1, a build-time copy of tools/Invoke-AvdHibernateWatchdog.ps1),
# streams its JSON log lines to the Functions log (-> Application Insights `traces` -> Log Analytics
# `AppTraces`), and emits one summary line.
#
# Output contract consumed by the web app (see docs/watchdog-kql.md):
#   * every line the tool writes is one JSON object: timestampUtc, level, message, runId, ...
#       level = Finding  -> a confirmed stuck session host
#       level = Action   -> a change that was made (drain, agent restart, deallocate, start)
#       level = Warning / Error / Info
#   * this wrapper adds exactly one line per run with  "kind":"watchdog.summary"  and
#     "schema":"avd-watchdog-summary/1".
param($Timer)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..' 'lib' 'WatchdogSettings.ps1')

function Write-SummaryLine {
    param([hashtable] $Data)
    $entry = [ordered]@{
        timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        level        = $(if ($Data.status -eq 'Succeeded') { 'Info' } else { 'Error' })
        message      = 'Watchdog summary'
        kind         = 'watchdog.summary'
        schema       = 'avd-watchdog-summary/1'
    }
    foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
    Write-Host ($entry | ConvertTo-Json -Compress -Depth 6)
}

# --- 1. Validate configuration (fails fast, names the bad setting, never prints values) ------------
try {
    $settings = Get-WatchdogSettings
}
catch {
    Write-SummaryLine @{ status = 'ConfigurationInvalid'; error = $_.Exception.Message }
    throw
}
foreach ($warning in $settings.Warnings) { Write-Warning $warning }

if ($Timer -and $Timer.PSObject.Properties['IsPastDue'] -and $Timer.IsPastDue) {
    Write-Warning 'Timer is past due; running now.'
}

# --- 2. Run the tool, streaming each JSON line to the log as it is produced -----------------------
$toolPath = Join-Path $PSScriptRoot '..' 'lib' 'Invoke-AvdHibernateWatchdog.ps1'
$toolParameters = $settings.Parameters
$started = (Get-Date).ToUniversalTime()
$counts = @{ finding = 0; action = 0; warning = 0; error = 0 }
$runId = $null
$fatal = $null

try {
    & $toolPath @toolParameters | ForEach-Object {
        $line = [string]$_
        Write-Host $line
        try {
            $json = $line | ConvertFrom-Json -ErrorAction Stop
            if (-not $runId -and $json.PSObject.Properties['runId']) { $runId = $json.runId }
            switch ([string]$json.level) {
                'Finding' { $counts.finding++ }
                'Action' { $counts.action++ }
                'Warning' { $counts.warning++ }
                'Error' { $counts.error++ }
            }
        }
        catch { <# a non-JSON line is passed through unchanged and not counted #> }
    }
}
catch {
    $fatal = $_.Exception.Message
}

# --- 3. Summary + invocation status ----------------------------------------------------------------
$status = if ($fatal) { 'Failed' } elseif ($counts.error -gt 0) { 'CompletedWithErrors' } else { 'Succeeded' }
$summary = @{
    status          = $status
    runId           = $runId
    mode            = $settings.Summary.mode
    hostPools       = $settings.Summary.hostPools
    findings        = $counts.finding
    actions         = $counts.action
    warnings        = $counts.warning
    errors          = $counts.error
    durationSeconds = [math]::Round(((Get-Date).ToUniversalTime() - $started).TotalSeconds, 1)
}
if ($fatal) { $summary.error = $fatal }
Write-SummaryLine $summary

# Mark the invocation failed when anything needs a human, so Azure Monitor failure alerts fire.
if ($fatal) { throw $fatal }
if ($counts.error -gt 0) { throw "Watchdog completed with $($counts.error) error(s); see the log lines with level=Error." }
