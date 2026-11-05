# Test double for Az.Accounts. Records calls in $global:AzFake.Calls.
function Get-AzContext { [CmdletBinding()] param() [pscustomobject]@{ Name = 'fake-context' } }
function Set-AzContext {
    [CmdletBinding()] param([string] $SubscriptionId)
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Set-AzContext'; Sub = $SubscriptionId })
    [pscustomobject]@{ Name = 'fake-context' }
}
function Connect-AzAccount {
    [CmdletBinding()] param([switch] $Identity, [string] $AccountId)
    $global:AzFake.Calls.Add([pscustomobject]@{ Cmd = 'Connect-AzAccount'; Identity = $Identity.IsPresent; AccountId = $AccountId })
    [pscustomobject]@{ Name = 'fake-context' }
}
function Disable-AzContextAutosave { [CmdletBinding()] param([string] $Scope) }
Export-ModuleMember -Function Get-AzContext, Set-AzContext, Connect-AzAccount, Disable-AzContextAutosave
