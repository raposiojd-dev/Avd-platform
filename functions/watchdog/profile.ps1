<#
.SYNOPSIS
    Runs once per PowerShell worker cold start. Signs in with the Function App's managed identity.

.DESCRIPTION
    Uses Connect-AzAccount -Identity. The watchdog uses a USER-ASSIGNED identity, whose client ID
    arrives in the AZURE_CLIENT_ID app setting (set by infra/modules/functionapp.bicep); when that
    setting is absent the system-assigned identity is used instead.

    No secret, key or certificate is involved. Nothing here is logged except the fact that sign-in
    succeeded or failed and the (non-secret) subscription count.

    Reference: https://learn.microsoft.com/azure/azure-functions/functions-reference-powershell#powershell-profile
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The Functions host exposes the managed identity endpoint through IDENTITY_ENDPOINT/IDENTITY_HEADER
# (or the legacy MSI_ENDPOINT/MSI_SECRET). Skip sign-in when running locally or under test.
$hasManagedIdentity = $env:IDENTITY_ENDPOINT -or $env:MSI_ENDPOINT -or $env:MSI_SECRET

if ($hasManagedIdentity) {
    try {
        Disable-AzContextAutosave -Scope Process | Out-Null
        $connectParams = @{ Identity = $true; ErrorAction = 'Stop' }
        if ($env:AZURE_CLIENT_ID) { $connectParams.AccountId = $env:AZURE_CLIENT_ID }
        Connect-AzAccount @connectParams | Out-Null
        Write-Information 'profile.ps1: managed identity sign-in succeeded.'
    }
    catch {
        # Log the failure reason (no secrets are involved) and fail the worker start so it is visible.
        Write-Error "profile.ps1: managed identity sign-in failed: $($_.Exception.Message)"
        throw
    }
}
else {
    Write-Information 'profile.ps1: no managed identity endpoint detected; skipping sign-in (local run).'
}
