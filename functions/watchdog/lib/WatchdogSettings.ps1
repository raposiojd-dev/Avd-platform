#Requires -Version 7.2
<#
.SYNOPSIS
    Reads, validates and normalises the WATCHDOG_* app settings.

.DESCRIPTION
    Dot-source this file, then call Get-WatchdogSettings. It returns a PSCustomObject:

        Parameters  hashtable ready to splat into lib/Invoke-AvdHibernateWatchdog.ps1
        Warnings    string[] of non-fatal configuration observations
        Summary     hashtable of the effective, non-sensitive settings (safe to log)

    If any setting is invalid the function throws ONE exception listing every problem by setting
    NAME. Values are never echoed in error text. There are no secrets in these settings (identity is a
    managed identity), but the rule is kept anyway so a future setting cannot leak by accident.

    App settings read (all optional except WATCHDOG_HOST_POOL_IDS):

        WATCHDOG_HOST_POOL_IDS              JSON array of host pool ARM resource IDs (required)
        WATCHDOG_MODE                       Report (default) | Remediate
        WATCHDOG_TRY_AGENT_RESTART          true|false (default false)
        WATCHDOG_START_AFTER_DEALLOCATE     true|false (default false)
        WATCHDOG_INCLUDE_NON_HIBERNATION_VMS true|false (default false)
        WATCHDOG_GRACE_MINUTES              5-240   (default 15)
        WATCHDOG_CONFIRM_CHECKS             1-10    (default 3)
        WATCHDOG_CONFIRM_INTERVAL_SECONDS   15-600  (default 60)
        WATCHDOG_AGENT_RESTART_WAIT_SECONDS 60-900  (default 180)
        WATCHDOG_MAX_REMEDIATIONS_PER_RUN   1-500   (default 10)
        WATCHDOG_MAX_STUCK_PERCENT          1-100   (default 50)
        WATCHDOG_EXCLUDE_TAG_NAME           string  (default avd-watchdog-exclude)
        AZURE_CLIENT_ID                     user-assigned managed identity client ID (optional)

    The ranges mirror the [ValidateRange] attributes of the underlying tool script, so a bad setting
    is reported by its app-setting name here instead of as an opaque parameter-binding error.
#>

$script:HostPoolIdPattern = '^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft\.DesktopVirtualization/hostPools/[^/]+$'

# The host.json functionTimeout. A run that is cut off mid-remediation cannot run its `finally`
# block, so a host could be left drained. Warn when the configuration could plausibly exceed this.
$script:FunctionTimeoutMinutes = 30

function Get-WatchdogSettings {
    [CmdletBinding()]
    param(
        # Injectable for tests; defaults to the process environment (= Function App settings).
        [System.Collections.IDictionary] $Source
    )

    $get = {
        param([string] $Name)
        if ($Source) {
            if ($Source.Contains($Name)) { return [string]$Source[$Name] } else { return $null }
        }
        return [Environment]::GetEnvironmentVariable($Name)
    }

    $errors = [System.Collections.Generic.List[string]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()

    # --- helpers (closures over $errors) ----------------------------------------------------------
    $readBool = {
        param([string] $Name, [bool] $Default)
        $raw = & $get $Name
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        switch ($raw.Trim().ToLowerInvariant()) {
            { $_ -in 'true', '1', 'yes' } { return $true }
            { $_ -in 'false', '0', 'no' } { return $false }
            default { $errors.Add("$Name must be true or false."); return $Default }
        }
    }
    $readInt = {
        param([string] $Name, [int] $Default, [int] $Min, [int] $Max)
        $raw = & $get $Name
        if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
        $parsed = 0
        if (-not [int]::TryParse($raw.Trim(), [ref]$parsed)) {
            $errors.Add("$Name must be a whole number between $Min and $Max.")
            return $Default
        }
        if ($parsed -lt $Min -or $parsed -gt $Max) {
            $errors.Add("$Name must be between $Min and $Max.")
            return $Default
        }
        return $parsed
    }

    # --- host pools ---------------------------------------------------------------------------------
    $hostPoolIds = @()
    $rawPools = & $get 'WATCHDOG_HOST_POOL_IDS'
    if ([string]::IsNullOrWhiteSpace($rawPools)) {
        $errors.Add('WATCHDOG_HOST_POOL_IDS is required (JSON array of host pool resource IDs).')
    }
    else {
        try {
            $parsedPools = ConvertFrom-Json -InputObject $rawPools -ErrorAction Stop
            # ConvertFrom-Json unrolls arrays on older hosts; normalise to an array of strings.
            $hostPoolIds = @($parsedPools | ForEach-Object { [string]$_ })
        }
        catch {
            $errors.Add('WATCHDOG_HOST_POOL_IDS is not valid JSON (expected e.g. ["/subscriptions/.../hostPools/name"]).')
        }
        if ($hostPoolIds.Count -eq 0 -and $errors.Count -eq 0) {
            $errors.Add('WATCHDOG_HOST_POOL_IDS must contain at least one host pool resource ID.')
        }
        $badIndexes = for ($i = 0; $i -lt $hostPoolIds.Count; $i++) {
            if ($hostPoolIds[$i] -notmatch $script:HostPoolIdPattern) { $i }
        }
        foreach ($i in @($badIndexes)) {
            $errors.Add("WATCHDOG_HOST_POOL_IDS entry #$($i + 1) is not a host pool resource ID (/subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.DesktopVirtualization/hostPools/<name>).")
        }
        if (@($hostPoolIds | Select-Object -Unique).Count -ne $hostPoolIds.Count) {
            $warnings.Add('WATCHDOG_HOST_POOL_IDS contains duplicate entries; each will be scanned more than once.')
        }
    }

    # --- mode ---------------------------------------------------------------------------------------
    $mode = 'Report'
    $rawMode = & $get 'WATCHDOG_MODE'
    if (-not [string]::IsNullOrWhiteSpace($rawMode)) {
        switch ($rawMode.Trim().ToLowerInvariant()) {
            'report' { $mode = 'Report' }
            'remediate' { $mode = 'Remediate' }
            default { $errors.Add('WATCHDOG_MODE must be Report or Remediate.') }
        }
    }

    $tryAgentRestart = & $readBool 'WATCHDOG_TRY_AGENT_RESTART' $false
    $startAfter = & $readBool 'WATCHDOG_START_AFTER_DEALLOCATE' $false
    $includeNonHib = & $readBool 'WATCHDOG_INCLUDE_NON_HIBERNATION_VMS' $false
    $grace = & $readInt 'WATCHDOG_GRACE_MINUTES' 15 5 240
    $confirmChecks = & $readInt 'WATCHDOG_CONFIRM_CHECKS' 3 1 10
    $confirmInterval = & $readInt 'WATCHDOG_CONFIRM_INTERVAL_SECONDS' 60 15 600
    $agentWait = & $readInt 'WATCHDOG_AGENT_RESTART_WAIT_SECONDS' 180 60 900
    $maxRem = & $readInt 'WATCHDOG_MAX_REMEDIATIONS_PER_RUN' 10 1 500
    $maxStuck = & $readInt 'WATCHDOG_MAX_STUCK_PERCENT' 50 1 100

    $excludeTag = & $get 'WATCHDOG_EXCLUDE_TAG_NAME'
    if ([string]::IsNullOrWhiteSpace($excludeTag)) { $excludeTag = 'avd-watchdog-exclude' }
    $excludeTag = $excludeTag.Trim()

    if ($errors.Count -gt 0) {
        throw ("Invalid watchdog configuration:`n - " + ($errors -join "`n - "))
    }

    # --- cross-setting observations ----------------------------------------------------------------
    if ($mode -eq 'Report') {
        if ($tryAgentRestart) { $warnings.Add('WATCHDOG_TRY_AGENT_RESTART is ignored in Report mode.') }
        if ($startAfter) { $warnings.Add('WATCHDOG_START_AFTER_DEALLOCATE is ignored in Report mode.') }
    }

    # Rough worst case: every pool pays the confirmation waits; each remediation takes a generous
    # 10 minutes (drain + optional agent wait + deallocate + verify + undrain + optional start).
    $perRemediationSeconds = 600 + $(if ($tryAgentRestart) { $agentWait } else { 0 })
    $worstSeconds = ($hostPoolIds.Count * ($confirmChecks - 1) * $confirmInterval) +
    $(if ($mode -eq 'Remediate') { $maxRem * $perRemediationSeconds } else { 0 })
    $worstMinutes = [math]::Ceiling($worstSeconds / 60)
    if ($worstMinutes -gt ($script:FunctionTimeoutMinutes - 5)) {
        $warnings.Add("Worst-case run time is about $worstMinutes minutes against a $($script:FunctionTimeoutMinutes)-minute function timeout. A run cut off mid-remediation cannot restore drain mode. Lower WATCHDOG_MAX_REMEDIATIONS_PER_RUN or WATCHDOG_CONFIRM_*.")
    }

    $parameters = @{
        HostPoolResourceId       = [string[]]$hostPoolIds
        Mode                     = $mode
        GracePeriodMinutes       = $grace
        ConfirmChecks            = $confirmChecks
        ConfirmIntervalSeconds   = $confirmInterval
        ExcludeTagName           = $excludeTag
        IncludeNonHibernationVms = $includeNonHib
        TryAgentRestart          = $tryAgentRestart
        AgentRestartWaitSeconds  = $agentWait
        StartAfterDeallocate     = $startAfter
        MaxRemediationsPerRun    = $maxRem
        MaxStuckPercent          = $maxStuck
    }
    $clientId = & $get 'AZURE_CLIENT_ID'
    if (-not [string]::IsNullOrWhiteSpace($clientId)) { $parameters.ManagedIdentityClientId = $clientId.Trim() }

    [pscustomobject]@{
        Parameters = $parameters
        Warnings   = @($warnings)
        Summary    = [ordered]@{
            mode                  = $mode
            hostPools             = $hostPoolIds.Count
            tryAgentRestart       = $tryAgentRestart
            startAfterDeallocate  = $startAfter
            graceMinutes          = $grace
            confirmChecks         = $confirmChecks
            maxRemediationsPerRun = $maxRem
            maxStuckPercent       = $maxStuck
            excludeTagName        = $excludeTag
            worstCaseMinutes      = $worstMinutes
        }
    }
}
