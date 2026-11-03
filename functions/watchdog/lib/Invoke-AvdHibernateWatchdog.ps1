#Requires -Version 7.2
#Requires -Modules Az.Accounts, Az.Compute, Az.DesktopVirtualization

<#
.SYNOPSIS
    Finds AVD session hosts that are stuck after resuming from hibernation and
    deallocates them so they come back with a clean boot.

.DESCRIPTION
    Detects two stuck patterns on hibernation-enabled session hosts:

      BlankPowerState            The VM instance view has no PowerState status
                                 (shows blank / "-" / unknown in the portal).
      RunningButAgentUnavailable The VM reports running but the AVD session host
                                 is Unavailable / NoHeartbeat / NeedsAssistance.
                                 Microsoft documents this as a known limitation:
                                 the RD Agent can fail to re-register after resume.

    A host is only acted on if:
      - the stuck condition has lasted at least -GracePeriodMinutes since the
        VM's last operation, AND
      - it is seen stuck on every one of -ConfirmChecks re-checks (guards against
        the intermittent missing power state Microsoft warns about), AND
      - it reports zero user sessions, AND
      - it is not tagged with -ExcludeTagName, AND
      - the run hasn't tripped the circuit breakers (-MaxStuckPercent per pool,
        -MaxRemediationsPerRun overall).

    Remediation ladder (Mode = Remediate):
      1. Drain the session host (AllowNewSession = false).
      2. Optional (-TryAgentRestart, running VMs only): restart RDAgentBootLoader
         via Run Command, wait, and re-check. If healthy, stop here.
      3. Deallocate the VM and verify it reached 'deallocated'.
      4. Restore the original AllowNewSession value.
      5. Optional (-StartAfterDeallocate): start the VM again (cold boot).

    Default Mode is Report: nothing is changed. Every finding and action is
    written to the output stream as one JSON line for log ingestion.

    No tenant, subscription or resource names live in this script. Everything
    environment-specific is passed in as parameters.

.PARAMETER HostPoolResourceId
    One or more full ARM resource IDs of the host pools to check.

.PARAMETER Mode
    Report (default) or Remediate.

.PARAMETER GracePeriodMinutes
    Minimum minutes since the VM's last operation before a host counts as stuck.

.PARAMETER ConfirmChecks
    Number of times a host must be seen stuck (including the first scan).

.PARAMETER ConfirmIntervalSeconds
    Wait between confirmation checks.

.PARAMETER ExcludeTagName
    VMs with this tag (any value) are never remediated.

.PARAMETER IncludeNonHibernationVms
    Also check VMs that don't have hibernation enabled (blank power state only).

.PARAMETER TryAgentRestart
    For RunningButAgentUnavailable, try restarting the AVD agent before deallocating.

.PARAMETER AgentRestartWaitSeconds
    How long to wait after an agent restart before re-checking health.

.PARAMETER StartAfterDeallocate
    Start the VM again after a successful deallocation.

.PARAMETER MaxRemediationsPerRun
    Hard cap on hosts remediated in one run.

.PARAMETER MaxStuckPercent
    If more than this percentage of a pool looks stuck, treat it as a platform or
    reporting problem: report only, don't remediate that pool.

.PARAMETER ManagedIdentityClientId
    Client ID of a user-assigned managed identity. Omit for system-assigned.

.EXAMPLE
    ./Invoke-AvdHibernateWatchdog.ps1 -HostPoolResourceId $hostPoolId

    Report-only scan of one host pool.

.EXAMPLE
    ./Invoke-AvdHibernateWatchdog.ps1 -HostPoolResourceId $ids -Mode Remediate -TryAgentRestart -WhatIf

    Shows what remediation would do without changing anything.

.EXAMPLE
    ./Invoke-AvdHibernateWatchdog.ps1 -HostPoolResourceId $ids -Mode Remediate

    Unattended remediation (Azure Function timer or Automation runbook, managed identity).

.NOTES
    WHERE THIS FITS IN JOHNDESK
    The console (Health Monitor and the Uptime & Stuck Risk scan) DETECTS these hosts and
    flags them CRITICAL ("stuck after hibernate resume"). This script is the unattended
    side: it runs on a schedule without the console open and fixes them. It is
    PowerShell 7 + Az, not part of the 5.1 bundle, so it is not in src\load-order.txt.

    HOW TO RUN IT
      Interactive test:  Connect-AzAccount; ./tools/Invoke-AvdHibernateWatchdog.ps1 -HostPoolResourceId <id>
      Scheduled:         Azure Function (PowerShell 7, timer trigger every 15 min) or an
                         Automation runbook (Automation schedules run at most hourly).
      Identity:          managed identity with the custom role in
                         tools/avd-hibernate-watchdog-role.json, scoped to the host pool and
                         session host resource groups only.

    RISK NOTE
      Default Mode is Report: nothing changes. Remediate never touches a host with user
      sessions, a host tagged avd-watchdog-exclude, or a pool where more than
      -MaxStuckPercent of hosts look stuck (that points at a platform problem, not a host).

    MICROSOFT GUIDANCE THIS IS BUILT ON
      https://learn.microsoft.com/troubleshoot/azure/virtual-desktop/troubleshoot-autoscale#issue-3-session-hosts-unavailable-after-hibernate-resume
      https://learn.microsoft.com/azure/virtual-machines/states-billing
      https://learn.microsoft.com/azure/virtual-machines/windows/hibernate-resume-troubleshooting-windows
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft\.DesktopVirtualization/hostPools/[^/]+$')]
    [string[]] $HostPoolResourceId,

    [ValidateSet('Report', 'Remediate')]
    [string] $Mode = 'Report',

    [ValidateRange(5, 240)]
    [int] $GracePeriodMinutes = 15,

    [ValidateRange(1, 10)]
    [int] $ConfirmChecks = 3,

    [ValidateRange(15, 600)]
    [int] $ConfirmIntervalSeconds = 60,

    [ValidateNotNullOrEmpty()]
    [string] $ExcludeTagName = 'avd-watchdog-exclude',

    [switch] $IncludeNonHibernationVms,

    [switch] $TryAgentRestart,

    [ValidateRange(60, 900)]
    [int] $AgentRestartWaitSeconds = 180,

    [switch] $StartAfterDeallocate,

    [ValidateRange(1, 500)]
    [int] $MaxRemediationsPerRun = 10,

    [ValidateRange(1, 100)]
    [int] $MaxStuckPercent = 50,

    [string] $ManagedIdentityClientId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$UnhealthyAgentStates = @('Unavailable', 'NoHeartbeat', 'NeedsAssistance')
$BlankPowerCodes = @('Blank', 'unknown')

#region Helpers

function Write-WatchdogLog {
    <# Emits one JSON log line to the output stream. Call only from the script body. #>
    param(
        [Parameter(Mandatory)][ValidateSet('Info', 'Warning', 'Error', 'Action', 'Finding')][string] $Level,
        [Parameter(Mandatory)][string] $Message,
        [hashtable] $Data = @{}
    )
    $entry = [ordered]@{
        timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        level        = $Level
        message      = $Message
    }
    foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
    Write-Output ($entry | ConvertTo-Json -Compress -Depth 6)
}

function Invoke-WithRetry {
    <#
    .SYNOPSIS
        Runs a script block, retrying transient/throttling failures with
        exponential backoff and jitter.
    #>
    param(
        [Parameter(Mandatory)][scriptblock] $ScriptBlock,
        [string] $Operation = 'Azure call',
        [ValidateRange(1, 10)][int] $MaxAttempts = 5,
        [ValidateRange(1, 30)][int] $BaseDelaySeconds = 2
    )
    for ($attempt = 1; ; $attempt++) {
        try {
            return & $ScriptBlock
        }
        catch {
            $message = $_.Exception.Message
            $statusCode = $null
            try {
                if ($_.Exception.PSObject.Properties['Response'] -and $_.Exception.Response) {
                    $statusCode = [int]$_.Exception.Response.StatusCode
                }
            }
            catch { $statusCode = $null }

            $isTransient = ($statusCode -in 408, 429, 500, 502, 503, 504) -or
                ($message -match '429|TooManyRequests|throttl|timed out|timeout|temporarily|ServiceUnavailable|InternalServerError|BadGateway|GatewayTimeout')

            if (-not $isTransient -or $attempt -ge $MaxAttempts) { throw }

            $delay = [math]::Min(60, $BaseDelaySeconds * [math]::Pow(2, $attempt - 1)) + ((Get-Random -Minimum 0 -Maximum 1000) / 1000)
            Write-Warning ("{0} failed (attempt {1}/{2}): {3} Retrying in {4:N1}s." -f $Operation, $attempt, $MaxAttempts, $message, $delay)
            Start-Sleep -Seconds $delay
        }
    }
}

function ConvertFrom-ResourceId {
    <# Splits an ARM resource ID into subscription, resource group and name. #>
    param([Parameter(Mandatory)][string] $ResourceId)
    if ($ResourceId -notmatch '^/subscriptions/(?<sub>[^/]+)/resourceGroups/(?<rg>[^/]+)/providers/(?<ns>[^/]+)/(?<type>[^/]+)/(?<name>[^/]+)$') {
        throw "Unrecognised resource ID format: $ResourceId"
    }
    [pscustomobject]@{
        SubscriptionId    = $Matches.sub
        ResourceGroupName = $Matches.rg
        Name              = $Matches.name
    }
}

function Get-VmPowerCode {
    <# Returns the power state ('running', 'deallocated', ...) or 'Blank' if none is reported. #>
    param([Parameter(Mandatory)] $VmStatus)
    # Guard the empty case explicitly: under StrictMode, .Code on an empty array throws,
    # and an empty PowerState list is exactly the condition we're hunting for.
    $match = @($VmStatus.Statuses | Where-Object { $_.Code -like 'PowerState/*' } | Select-Object -First 1)
    if ($match.Count -eq 0) { return 'Blank' }
    $code = [string]$match[0].Code
    if ([string]::IsNullOrWhiteSpace($code)) { return 'Blank' }
    return ($code -replace '^PowerState/', '')
}

function Get-VmLastOperationUtc {
    <# Time of the VM's last provisioning operation (e.g. the resume), or $null. #>
    param([Parameter(Mandatory)] $VmStatus)
    $status = @($VmStatus.Statuses | Where-Object { $_.Code -like 'ProvisioningState/*' } | Select-Object -First 1)
    if ($status.Count -eq 0 -or -not $status[0].Time) { return $null }
    return ([datetime]$status[0].Time).ToUniversalTime()
}

function Get-HostSnapshot {
    <# Reads the current AVD session host record plus the VM model and instance view. #>
    param(
        [Parameter(Mandatory)] $Pool,
        [Parameter(Mandatory)][string] $SessionHostName
    )
    $sessionHost = Invoke-WithRetry -Operation "Get session host $SessionHostName" -ScriptBlock {
        Get-AzWvdSessionHost -SubscriptionId $Pool.SubscriptionId -ResourceGroupName $Pool.ResourceGroupName `
            -HostPoolName $Pool.Name -Name $SessionHostName
    }
    $vmRef = ConvertFrom-ResourceId -ResourceId $sessionHost.ResourceId
    $vm = Invoke-WithRetry -Operation "Get VM $($vmRef.Name)" -ScriptBlock {
        Get-AzVM -ResourceGroupName $vmRef.ResourceGroupName -Name $vmRef.Name
    }
    $vmStatus = Invoke-WithRetry -Operation "Get VM status $($vmRef.Name)" -ScriptBlock {
        Get-AzVM -ResourceGroupName $vmRef.ResourceGroupName -Name $vmRef.Name -Status
    }
    [pscustomobject]@{
        SessionHostName = $SessionHostName
        SessionHost     = $sessionHost
        VmRef           = $vmRef
        Vm              = $vm
        VmStatus        = $vmStatus
    }
}

function Get-StuckReason {
    <# Returns a stuck reason for the snapshot, or $null if the host looks fine. #>
    param(
        [Parameter(Mandatory)] $Snapshot,
        [Parameter(Mandatory)][datetime] $NowUtc
    )
    $hibernationEnabled = [bool]($Snapshot.Vm.AdditionalCapabilities -and $Snapshot.Vm.AdditionalCapabilities.HibernationEnabled)
    if (-not $hibernationEnabled -and -not $IncludeNonHibernationVms) { return $null }

    $powerCode = Get-VmPowerCode -VmStatus $Snapshot.VmStatus
    $agentStatus = [string]$Snapshot.SessionHost.Status

    $lastOp = Get-VmLastOperationUtc -VmStatus $Snapshot.VmStatus
    if ($lastOp -and ($NowUtc - $lastOp).TotalMinutes -lt $GracePeriodMinutes) { return $null }

    if ($powerCode -in $BlankPowerCodes) {
        if ($agentStatus -eq 'Available') { return $null }   # host is serving users; ARM reporting glitch only
        return 'BlankPowerState'
    }
    if ($hibernationEnabled -and $powerCode -eq 'running' -and $agentStatus -in $UnhealthyAgentStates) {
        return 'RunningButAgentUnavailable'
    }
    return $null
}

#endregion Helpers

#region Main

$runId = [guid]::NewGuid().ToString()
$startedUtc = (Get-Date).ToUniversalTime()
$results = [System.Collections.Generic.List[object]]::new()
$remediationCount = 0

Write-WatchdogLog -Level Info -Message 'Watchdog run started' -Data @{
    runId = $runId; mode = $Mode; hostPools = $HostPoolResourceId.Count
    graceMinutes = $GracePeriodMinutes; confirmChecks = $ConfirmChecks
}

# Sign in with managed identity unless a context already exists (interactive use).
try {
    if (-not (Get-AzContext -ErrorAction SilentlyContinue)) {
        $connectArgs = @{ Identity = $true; ErrorAction = 'Stop' }
        if ($ManagedIdentityClientId) { $connectArgs.AccountId = $ManagedIdentityClientId }
        Connect-AzAccount @connectArgs | Out-Null
    }
}
catch {
    Write-WatchdogLog -Level Error -Message 'Sign-in failed' -Data @{ runId = $runId; error = $_.Exception.Message }
    throw
}

foreach ($poolId in $HostPoolResourceId) {
    $pool = ConvertFrom-ResourceId -ResourceId $poolId

    try {
        Invoke-WithRetry -Operation 'Set subscription context' -ScriptBlock {
            Set-AzContext -SubscriptionId $pool.SubscriptionId -ErrorAction Stop | Out-Null
        } | Out-Null

        $sessionHosts = @(Invoke-WithRetry -Operation "List session hosts in $($pool.Name)" -ScriptBlock {
            Get-AzWvdSessionHost -SubscriptionId $pool.SubscriptionId -ResourceGroupName $pool.ResourceGroupName -HostPoolName $pool.Name
        })
    }
    catch {
        Write-WatchdogLog -Level Error -Message 'Could not read host pool' -Data @{ runId = $runId; hostPool = $pool.Name; error = $_.Exception.Message }
        continue
    }

    if ($sessionHosts.Count -eq 0) {
        Write-WatchdogLog -Level Info -Message 'No session hosts in pool' -Data @{ runId = $runId; hostPool = $pool.Name }
        continue
    }

    # --- Pass 1: initial scan ---------------------------------------------------
    $candidates = @{}
    foreach ($sh in $sessionHosts) {
        $shortName = ($sh.Name -split '/')[-1]
        try {
            $snap = Get-HostSnapshot -Pool $pool -SessionHostName $shortName
            $reason = Get-StuckReason -Snapshot $snap -NowUtc (Get-Date).ToUniversalTime()
            if ($reason) { $candidates[$shortName] = $reason }
        }
        catch {
            Write-WatchdogLog -Level Warning -Message 'Could not evaluate session host' -Data @{
                runId = $runId; hostPool = $pool.Name; sessionHost = $shortName; error = $_.Exception.Message
            }
        }
    }

    if ($candidates.Count -eq 0) {
        Write-WatchdogLog -Level Info -Message 'No stuck hosts found' -Data @{ runId = $runId; hostPool = $pool.Name; hostsChecked = $sessionHosts.Count }
        continue
    }

    # --- Circuit breaker: too many at once points to a platform/reporting issue ---
    $stuckPercent = [math]::Round(100 * $candidates.Count / $sessionHosts.Count, 1)
    $poolBlocked = $stuckPercent -gt $MaxStuckPercent -and $candidates.Count -gt 1
    if ($poolBlocked) {
        Write-WatchdogLog -Level Warning -Message 'Circuit breaker tripped: too many hosts look stuck; report only for this pool' -Data @{
            runId = $runId; hostPool = $pool.Name; stuck = $candidates.Count; total = $sessionHosts.Count; stuckPercent = $stuckPercent
        }
    }

    # --- Pass 2..N: confirm the condition persists -------------------------------
    for ($check = 2; $check -le $ConfirmChecks -and $candidates.Count -gt 0; $check++) {
        Start-Sleep -Seconds $ConfirmIntervalSeconds
        foreach ($name in @($candidates.Keys)) {
            try {
                $snap = Get-HostSnapshot -Pool $pool -SessionHostName $name
                $reason = Get-StuckReason -Snapshot $snap -NowUtc (Get-Date).ToUniversalTime()
                if ($reason) { $candidates[$name] = $reason } else { $candidates.Remove($name) }
            }
            catch {
                $candidates.Remove($name)   # can't confirm -> don't act
            }
        }
    }

    # --- Act on confirmed hosts ---------------------------------------------------
    foreach ($name in @($candidates.Keys)) {
        $reason = $candidates[$name]
        try {
            $snap = Get-HostSnapshot -Pool $pool -SessionHostName $name
        }
        catch {
            Write-WatchdogLog -Level Warning -Message 'Could not re-read host before acting; skipped' -Data @{
                runId = $runId; hostPool = $pool.Name; sessionHost = $name; error = $_.Exception.Message
            }
            continue
        }
        $sh = $snap.SessionHost
        $sessions = [int]$sh.Session
        $excluded = $snap.Vm.Tags -and $snap.Vm.Tags.ContainsKey($ExcludeTagName)

        $finding = @{
            runId       = $runId
            hostPool    = $pool.Name
            sessionHost = $name
            vm          = $snap.VmRef.Name
            reason      = $reason
            powerState  = Get-VmPowerCode -VmStatus $snap.VmStatus
            agentStatus = [string]$sh.Status
            sessions    = $sessions
        }
        Write-WatchdogLog -Level Finding -Message 'Stuck session host confirmed' -Data $finding

        $skipReason = $null
        if ($Mode -eq 'Report') { $skipReason = 'ReportMode' }
        elseif ($poolBlocked) { $skipReason = 'CircuitBreaker' }
        elseif ($excluded) { $skipReason = 'ExcludeTag' }
        elseif ($sessions -gt 0) { $skipReason = 'ActiveSessions' }
        elseif ($remediationCount -ge $MaxRemediationsPerRun) { $skipReason = 'MaxRemediationsReached' }

        if ($skipReason) {
            Write-WatchdogLog -Level Info -Message 'Not remediating' -Data ($finding + @{ skipReason = $skipReason })
            $results.Add([pscustomobject]($finding + @{ outcome = "Skipped:$skipReason" }))
            continue
        }

        $originalAllowNewSession = [bool]$sh.AllowNewSession
        $outcome = 'Failed'
        try {
            # 1. Drain
            if ($PSCmdlet.ShouldProcess("$($pool.Name)/$name", 'Drain session host (AllowNewSession = false)')) {
                Invoke-WithRetry -Operation "Drain $name" -ScriptBlock {
                    Update-AzWvdSessionHost -SubscriptionId $pool.SubscriptionId -ResourceGroupName $pool.ResourceGroupName `
                        -HostPoolName $pool.Name -Name $name -AllowNewSession:$false
                } | Out-Null
                Write-WatchdogLog -Level Action -Message 'Drained session host' -Data $finding
            }

            # 2. Optional agent restart (only possible while the guest is running)
            $recovered = $false
            if ($TryAgentRestart -and $reason -eq 'RunningButAgentUnavailable' -and
                $PSCmdlet.ShouldProcess($snap.VmRef.Name, 'Restart RDAgentBootLoader via Run Command')) {
                try {
                    Invoke-WithRetry -Operation "Agent restart $name" -ScriptBlock {
                        Invoke-AzVMRunCommand -ResourceGroupName $snap.VmRef.ResourceGroupName -VMName $snap.VmRef.Name `
                            -CommandId 'RunPowerShellScript' -ScriptString 'Restart-Service -Name RDAgentBootLoader -Force'
                    } | Out-Null
                    Write-WatchdogLog -Level Action -Message 'Restarted AVD agent; waiting to re-check' -Data $finding
                    Start-Sleep -Seconds $AgentRestartWaitSeconds
                    $after = Get-HostSnapshot -Pool $pool -SessionHostName $name
                    $recovered = ([string]$after.SessionHost.Status -eq 'Available')
                }
                catch {
                    Write-WatchdogLog -Level Warning -Message 'Agent restart failed; falling back to deallocate' -Data ($finding + @{ error = $_.Exception.Message })
                }
            }

            if ($recovered) {
                $outcome = 'RecoveredByAgentRestart'
            }
            else {
                # 3. Deallocate and verify
                if ($PSCmdlet.ShouldProcess($snap.VmRef.Name, 'Deallocate VM')) {
                    Invoke-WithRetry -Operation "Deallocate $($snap.VmRef.Name)" -ScriptBlock {
                        Stop-AzVM -ResourceGroupName $snap.VmRef.ResourceGroupName -Name $snap.VmRef.Name -Force
                    } | Out-Null

                    $verify = Invoke-WithRetry -Operation "Verify $($snap.VmRef.Name)" -ScriptBlock {
                        Get-AzVM -ResourceGroupName $snap.VmRef.ResourceGroupName -Name $snap.VmRef.Name -Status
                    }
                    $finalPower = Get-VmPowerCode -VmStatus $verify
                    if ($finalPower -ne 'deallocated') { throw "VM did not reach deallocated (now '$finalPower')." }
                    Write-WatchdogLog -Level Action -Message 'Deallocated VM' -Data $finding
                    $outcome = 'Deallocated'

                    # 5. Optional cold start
                    if ($StartAfterDeallocate -and $PSCmdlet.ShouldProcess($snap.VmRef.Name, 'Start VM')) {
                        Invoke-WithRetry -Operation "Start $($snap.VmRef.Name)" -ScriptBlock {
                            Start-AzVM -ResourceGroupName $snap.VmRef.ResourceGroupName -Name $snap.VmRef.Name
                        } | Out-Null
                        Write-WatchdogLog -Level Action -Message 'Started VM after deallocation' -Data $finding
                        $outcome = 'DeallocatedAndStarted'
                    }
                }
                else {
                    $outcome = 'WhatIf'
                }
            }
            $remediationCount++
        }
        catch {
            Write-WatchdogLog -Level Error -Message 'Remediation failed - needs manual attention' -Data ($finding + @{ error = $_.Exception.Message })
        }
        finally {
            # 4. Always put drain mode back the way we found it
            if ($originalAllowNewSession -and $PSCmdlet.ShouldProcess("$($pool.Name)/$name", 'Restore AllowNewSession = true')) {
                try {
                    Invoke-WithRetry -Operation "Undrain $name" -ScriptBlock {
                        Update-AzWvdSessionHost -SubscriptionId $pool.SubscriptionId -ResourceGroupName $pool.ResourceGroupName `
                            -HostPoolName $pool.Name -Name $name -AllowNewSession:$true
                    } | Out-Null
                }
                catch {
                    Write-WatchdogLog -Level Error -Message 'Could not restore drain mode' -Data ($finding + @{ error = $_.Exception.Message })
                }
            }
        }

        $results.Add([pscustomobject]($finding + @{ outcome = $outcome }))
    }
}

Write-WatchdogLog -Level Info -Message 'Watchdog run finished' -Data @{
    runId = $runId; mode = $Mode
    durationSeconds = [math]::Round(((Get-Date).ToUniversalTime() - $startedUtc).TotalSeconds, 1)
    stuckConfirmed = $results.Count; remediated = $remediationCount
    outcomes = @($results | ForEach-Object { "$($_.sessionHost)=$($_.outcome)" })
}

#endregion Main
