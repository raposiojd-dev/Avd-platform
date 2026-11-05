# Test double for Az.Compute. State lives in $global:AzFake.Hosts[<session host name>] (see FakeAzure.ps1).
function Find-FakeHostByVm {
    param([string] $VmName)
    foreach ($h in $global:AzFake.Hosts.Values) { if ($h.Vm -eq $VmName) { return $h } }
    throw "Fake: unknown VM '$VmName'"
}

function Get-AzVM {
    [CmdletBinding()]
    param([string] $ResourceGroupName, [string] $Name, [switch] $Status)
    $h = Find-FakeHostByVm $Name
    if ($Status) {
        $statuses = @([pscustomobject]@{ Code = 'ProvisioningState/succeeded'; Time = (Get-Date).AddMinutes(-$h.MinutesSinceLastOp) })
        if ($h.Power -ne 'Blank') { $statuses += [pscustomobject]@{ Code = "PowerState/$($h.Power)"; Time = $null } }
        return [pscustomobject]@{ Name = $Name; Statuses = $statuses }
    }
    [pscustomobject]@{
        Name                   = $Name
        Tags                   = [hashtable]$h.Tags
        AdditionalCapabilities = $(if ($h.Hibernation) { [pscustomobject]@{ HibernationEnabled = $true } } else { $null })
    }
}

function Stop-AzVM {
    [CmdletBinding()] param([string] $ResourceGroupName, [string] $Name, [switch] $Force)
    $h = Find-FakeHostByVm $Name
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Stop-AzVM'; Vm = $Name })
    $h.Power = 'deallocated'
}

function Start-AzVM {
    [CmdletBinding()] param([string] $ResourceGroupName, [string] $Name)
    $h = Find-FakeHostByVm $Name
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Start-AzVM'; Vm = $Name })
    $h.Power = 'running'
}

function Invoke-AzVMRunCommand {
    [CmdletBinding()] param([string] $ResourceGroupName, [string] $VMName, [string] $CommandId, [string] $ScriptString)
    $h = Find-FakeHostByVm $VMName
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Invoke-AzVMRunCommand'; Vm = $VMName; Script = $ScriptString })
    if ($global:AzFake.AgentRestartHeals) { $h.Status = 'Available' }
}
Export-ModuleMember -Function Get-AzVM, Stop-AzVM, Start-AzVM, Invoke-AzVMRunCommand
