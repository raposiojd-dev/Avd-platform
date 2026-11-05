# Test double for Az.DesktopVirtualization.
function ConvertTo-FakeSessionHost {
    param($H, [string] $PoolName)
    [pscustomobject]@{
        Name            = "$PoolName/$($H.Name)"
        Status          = $H.Status
        Session         = $H.Sessions
        AllowNewSession = $H.AllowNewSession
        ResourceId      = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-contoso-avd/providers/Microsoft.Compute/virtualMachines/$($H.Vm)"
    }
}

function Get-AzWvdSessionHost {
    [CmdletBinding()]
    param([string] $SubscriptionId, [string] $ResourceGroupName, [string] $HostPoolName, [string] $Name)
    $pool = $global:AzFake.Pools[$HostPoolName]
    if (-not $pool) { throw "Fake: unknown host pool '$HostPoolName'" }
    if ($Name) {
        if (-not $pool.ContainsKey($Name)) { throw "Fake: unknown session host '$Name'" }
        return ConvertTo-FakeSessionHost $pool[$Name] $HostPoolName
    }
    foreach ($h in $pool.Values) { ConvertTo-FakeSessionHost $h $HostPoolName }
}

function Update-AzWvdSessionHost {
    [CmdletBinding()]
    param([string] $SubscriptionId, [string] $ResourceGroupName, [string] $HostPoolName, [string] $Name, [switch] $AllowNewSession)
    $pool = $global:AzFake.Pools[$HostPoolName]
    $pool[$Name].AllowNewSession = $AllowNewSession.IsPresent
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Update-AzWvdSessionHost'; Host = $Name; AllowNewSession = $AllowNewSession.IsPresent })
}
Export-ModuleMember -Function Get-AzWvdSessionHost, Update-AzWvdSessionHost
