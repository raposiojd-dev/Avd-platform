# In-memory fake AVD fleet used by the stub Az modules. Dot-source from Invoke-Tests.ps1.

$script:FakePoolName = 'hp-contoso-01'
$script:FakePoolId = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-contoso-avd/providers/Microsoft.DesktopVirtualization/hostPools/$script:FakePoolName"

function New-FakeFleet {
    <#
    .PARAMETER Hosts
        Array of hashtables. Keys (all optional except Name):
          Name (short name e.g. 'avdh-01'), Status ('Available'|'Unavailable'|...), Sessions (int),
          Power ('running'|'Blank'|'deallocated'), Hibernation (bool), Tags (hashtable),
          MinutesSinceLastOp (int), AllowNewSession (bool)
    #>
    param([Parameter(Mandatory)][hashtable[]] $Hosts)

    $pool = @{}
    foreach ($spec in $Hosts) {
        $name = "$($spec.Name).contoso.example"
        $pool[$name] = @{
            Name               = $name
            Vm                 = $spec.Name
            Status             = $(if ($spec.ContainsKey('Status')) { $spec.Status } else { 'Available' })
            Sessions           = $(if ($spec.ContainsKey('Sessions')) { $spec.Sessions } else { 0 })
            Power              = $(if ($spec.ContainsKey('Power')) { $spec.Power } else { 'running' })
            Hibernation        = $(if ($spec.ContainsKey('Hibernation')) { $spec.Hibernation } else { $true })
            Tags               = $(if ($spec.ContainsKey('Tags')) { $spec.Tags } else { @{} })
            MinutesSinceLastOp = $(if ($spec.ContainsKey('MinutesSinceLastOp')) { $spec.MinutesSinceLastOp } else { 120 })
            AllowNewSession    = $(if ($spec.ContainsKey('AllowNewSession')) { $spec.AllowNewSession } else { $true })
        }
    }
    $global:AzFake = @{
        Pools             = @{ $script:FakePoolName = $pool }
        Calls             = [System.Collections.Generic.List[object]]::new()
        Sleeps            = [System.Collections.Generic.List[int]]::new()
        OnSleep           = $null
        AgentRestartHeals = $false
    }
}

function Get-FakeHost { param([string] $ShortName) $global:AzFake.Pools[$script:FakePoolName]["$ShortName.contoso.example"] }

# A host that is stuck after hibernate resume: VM running, AVD agent Unavailable, no sessions.
function New-StuckSpec { param([string] $Name, [hashtable] $Extra = @{}) $s = @{ Name = $Name; Status = 'Unavailable'; Power = 'running' }; foreach ($k in $Extra.Keys) { $s[$k] = $Extra[$k] }; $s }
function New-HealthySpec { param([string] $Name) @{ Name = $Name; Status = 'Available'; Power = 'running'; Sessions = 3 } }

# Replace Start-Sleep so tests never wait; optionally run a hook "between checks".
function global:Start-Sleep {
    param([double] $Seconds, [int] $Milliseconds)
    $global:AzFake.Sleeps.Add([int]$Seconds)
    if ($global:AzFake.OnSleep) { & $global:AzFake.OnSleep }
}

function Get-MutatingCalls {
    @($global:AzFake.Calls | Where-Object { $_.Cmd -in 'Update-AzWvdSessionHost', 'Stop-AzVM', 'Start-AzVM', 'Invoke-AzVMRunCommand' })
}

function Invoke-WatchdogTool {
    <# Runs the real tool script against the fake fleet and returns parsed JSON log lines. #>
    param([hashtable] $Parameters = @{})
    $tool = Join-Path $PSScriptRoot '..' 'lib' 'Invoke-AvdHibernateWatchdog.ps1'
    $p = @{ HostPoolResourceId = @($script:FakePoolId); ConfirmChecks = 1 }
    foreach ($k in $Parameters.Keys) { $p[$k] = $Parameters[$k] }
    $lines = @(& $tool @p 3>$null)
    @($lines | ForEach-Object { $_ | ConvertFrom-Json })
}
