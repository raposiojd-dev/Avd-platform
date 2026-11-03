# Module requirements for the watchdog Function.
#
# IMPORTANT: Flex Consumption does NOT support the Functions "managed dependencies" feature
# (https://learn.microsoft.com/azure/azure-functions/functions-reference-powershell#dependency-management),
# so host.json sets managedDependency.enabled = false and build.ps1 bundles these modules into ./Modules
# at package time with Save-Module. This file is the single list of what to bundle (build.ps1 reads it).
#
# Majors are pinned; build.ps1 resolves the newest matching version and records the exact versions it
# bundled in Modules/modules.lock.json so every release is reproducible and auditable.
#
# Major versions confirmed against the Azure PowerShell release notes
# (https://learn.microsoft.com/powershell/azure/release-notes-azureps):
#   Az.Accounts 5.x   (5.0.0 May 2025; 5.5.3 Sep 2026)
#   Az.Compute  11.x  (11.9.0 Sep 2026)
#   Az.DesktopVirtualization 5.x  (5.4.0 Nov 2024 is the newest the release notes retrieved here show;
#                                  CONFIRM no 6.x exists before the first release build)
@{
    'Az.Accounts'             = '5.*'
    'Az.Compute'              = '11.*'
    'Az.DesktopVirtualization' = '5.*'
}
