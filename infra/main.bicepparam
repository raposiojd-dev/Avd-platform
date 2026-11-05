// =====================================================================================================
// EXAMPLE parameters ONLY. Every value below is a placeholder (contoso / all-zero GUIDs).
// Copy this file to a location OUTSIDE the repository (e.g. deploy.<customer>.bicepparam), replace the
// values, and never commit real tenant IDs, subscription IDs or client IDs.
// =====================================================================================================
using 'main.bicep'

// --- Core --------------------------------------------------------------------------------------------
param location = 'westeurope'                 // Must support Flex Consumption
param platformResourceGroupName = 'rg-avdplatform-contoso'
param namePrefix = 'avdp'                      // 2-8 lowercase letters/digits
param tags = {
  product: 'avd-platform'
  owner: 'it-operations@contoso.example'
  environment: 'production'
}

// --- What the product may manage --------------------------------------------------------------------
// RBAC is granted on exactly these resource groups and nowhere else.
param managedResourceGroupIds = [
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-avd-hostpools-contoso'
]
param enableAgentRestart = false               // Run Command = script execution as SYSTEM. Leave off unless needed.
param enableWebActions = false                 // false = web app is read-only on the fleet.

// --- Sign-in ----------------------------------------------------------------------------------------
// 'builtin' (default): no IDs here. After deploying, open the site and complete the one-time Setup page.
param authMode = 'builtin'

// --- Watchdog ---------------------------------------------------------------------------------------
param watchdogMode = 'Report'                  // Start in Report. Switch to Remediate (and redeploy) once findings look right.
param watchdogHostPoolIds = [
  '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-avd-hostpools-contoso/providers/Microsoft.DesktopVirtualization/hostPools/hp-contoso-pooled-01'
]
param watchdogSchedule = '0 */15 * * * *'      // every 15 minutes, UTC
param watchdogTryAgentRestart = false
param watchdogStartAfterDeallocate = false
param watchdogGraceMinutes = 15
param watchdogConfirmChecks = 3
param watchdogConfirmIntervalSeconds = 60
param watchdogMaxRemediationsPerRun = 10
param watchdogMaxStuckPercent = 50
param watchdogExcludeTagName = 'avd-watchdog-exclude'

// --- Sizing / hardening -----------------------------------------------------------------------------
param webPlanSku = 'P0v3'
param logRetentionDays = 90
param keyVaultRetentionDays = 90
