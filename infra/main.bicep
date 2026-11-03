// =====================================================================================================
// AVD Platform - customer-hosted deployment
//
// Scope: SUBSCRIPTION. Reasons (see infra/README.md "Why subscription scope"):
//   1. Custom Azure RBAC role definitions are subscription-level (or higher) resources.
//   2. Role assignments must land on the customer's *managed* resource groups, which are separate
//      from (and possibly in other subscriptions than) the product's own resource group.
//   3. The product's own resource group is created here so the customer runs ONE deployment.
//
// Deploy:  az deployment sub create --location <region> --template-file main.bicep --parameters main.bicepparam
// Needs:   Owner (or Contributor + User Access Administrator) on the target subscription, and
//          User Access Administrator/Owner on every managed resource group's subscription.
//
// Nothing in this file is customer-specific. Tenant, client, resource-group and host-pool values are
// parameters supplied at deployment time. No secret is a parameter, an output or an app setting.
// =====================================================================================================
targetScope = 'subscription'

// ---------------------------------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------------------------------
@description('Azure region for all product resources. Must support Flex Consumption (https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to#view-currently-supported-regions).')
param location string

@description('Name of the resource group CREATED for the product itself (not an AVD resource group).')
@minLength(1)
@maxLength(90)
param platformResourceGroupName string

@description('2-8 lowercase letters/digits; prefixes every resource name. Unique suffixes are added automatically.')
@minLength(2)
@maxLength(8)
param namePrefix string

@description('Tags applied to every resource and the platform resource group.')
param tags object = {}

// ---------------------------------------------------------------------------------------------------
// What the product may manage
// ---------------------------------------------------------------------------------------------------
@description('Full resource IDs of the resource groups that contain the AVD host pools and session-host VMs the product may manage, e.g. "/subscriptions/<sub-id>/resourceGroups/<rg-name>". RBAC is granted ONLY on these scopes.')
@minLength(1)
param managedResourceGroupIds array

@description('Allow the watchdog to restart the AVD agent inside a VM via Run Command. Run Command executes an arbitrary script as SYSTEM, so this is OFF by default and adds a separate custom role. Has no effect unless watchdogMode is Remediate.')
param enableAgentRestart bool = false

@description('Allow the web app to perform admin-triggered write actions (drain/undrain, restart, deallocate, start). OFF by default: the web app is then strictly read-only on the fleet.')
param enableWebActions bool = false

// ---------------------------------------------------------------------------------------------------
// Sign-in (Microsoft Entra ID, via App Service Authentication)
// ---------------------------------------------------------------------------------------------------
@description('Microsoft Entra tenant (directory) ID that administrators sign in against.')
param entraTenantId string

@description('Client (application) ID of the Entra app registration created for the web app. See README step 2.')
param entraAppClientId string

@description('Behaviour for unauthenticated requests. Anonymous access is never allowed.')
@allowed([
  'RedirectToLoginPage'
  'Return401'
])
param unauthenticatedClientAction string = 'RedirectToLoginPage'

// ---------------------------------------------------------------------------------------------------
// Watchdog (timer Function)
// ---------------------------------------------------------------------------------------------------
@description('Full resource IDs of the host pools the watchdog checks. Each must be inside one of managedResourceGroupIds, otherwise RBAC will deny it.')
param watchdogHostPoolIds array = []

@description('Report = detect and log only (the identity is granted read-only roles). Remediate = also drain/deallocate stuck hosts (the identity is granted the operator role). Changing mode requires redeploying so RBAC follows.')
@allowed([
  'Report'
  'Remediate'
])
param watchdogMode string = 'Report'

@description('NCRONTAB (six-field) schedule, evaluated in UTC on Flex Consumption.')
param watchdogSchedule string = '0 */15 * * * *'

@description('Try restarting the AVD agent before deallocating. Effective only if enableAgentRestart is also true and watchdogMode is Remediate.')
param watchdogTryAgentRestart bool = false

@description('Start the VM again after a successful deallocation (cold boot).')
param watchdogStartAfterDeallocate bool = false

@description('Minutes since the VM last changed state before a host counts as stuck.')
@minValue(5)
@maxValue(240)
param watchdogGraceMinutes int = 15

@description('How many consecutive checks must agree before acting.')
@minValue(1)
@maxValue(10)
param watchdogConfirmChecks int = 3

@description('Seconds between confirmation checks.')
@minValue(15)
@maxValue(600)
param watchdogConfirmIntervalSeconds int = 60

@description('Hard cap on hosts remediated in one run.')
@minValue(1)
@maxValue(500)
param watchdogMaxRemediationsPerRun int = 10

@description('If more than this percentage of a pool looks stuck, treat it as a platform problem and do not remediate that pool.')
@minValue(1)
@maxValue(100)
param watchdogMaxStuckPercent int = 50

@description('VMs carrying this tag (any value) are never touched.')
param watchdogExcludeTagName string = 'avd-watchdog-exclude'

// ---------------------------------------------------------------------------------------------------
// Sizing / hardening knobs
// ---------------------------------------------------------------------------------------------------
@description('App Service plan SKU for the web app.')
@allowed([
  'B1'
  'B2'
  'P0v3'
  'P1v3'
  'P1v2'
])
param webPlanSku string = 'P0v3'

@description('Log Analytics retention in days.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 90

@description('Key Vault soft-delete retention (7-90 days). Cannot be changed after creation.')
@minValue(7)
@maxValue(90)
param keyVaultRetentionDays int = 90

// ---------------------------------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------------------------------
var uniq = uniqueString(subscription().subscriptionId, platformResourceGroupName, namePrefix)
var nameToken = '${namePrefix}-${take(uniq, 5)}'
var storageAccountName = take('st${namePrefix}${uniq}', 24)
var deploymentContainerName = 'app-package-${nameToken}'
var watchdogCanRemediate = watchdogMode == 'Remediate'

var managedSubscriptionScopes = [for rgId in managedResourceGroupIds: '/subscriptions/${split(rgId, '/')[2]}']
var assignableScopes = union([subscription().id], managedSubscriptionScopes)

// Safety: the agent-restart switch is only honoured when the watchdog may remediate at all.
var effectiveTryAgentRestart = watchdogTryAgentRestart && enableAgentRestart && watchdogCanRemediate

var watchdogSettings = {
  WATCHDOG_SCHEDULE: watchdogSchedule
  WATCHDOG_MODE: watchdogMode
  WATCHDOG_HOST_POOL_IDS: string(watchdogHostPoolIds)
  WATCHDOG_TRY_AGENT_RESTART: toLower(string(effectiveTryAgentRestart))
  WATCHDOG_START_AFTER_DEALLOCATE: toLower(string(watchdogStartAfterDeallocate))
  WATCHDOG_GRACE_MINUTES: string(watchdogGraceMinutes)
  WATCHDOG_CONFIRM_CHECKS: string(watchdogConfirmChecks)
  WATCHDOG_CONFIRM_INTERVAL_SECONDS: string(watchdogConfirmIntervalSeconds)
  WATCHDOG_MAX_REMEDIATIONS_PER_RUN: string(watchdogMaxRemediationsPerRun)
  WATCHDOG_MAX_STUCK_PERCENT: string(watchdogMaxStuckPercent)
  WATCHDOG_EXCLUDE_TAG_NAME: watchdogExcludeTagName
}

// ---------------------------------------------------------------------------------------------------
// Resource group + custom roles
// ---------------------------------------------------------------------------------------------------
resource platformRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: platformResourceGroupName
  location: location
  tags: tags
}

module roles 'modules/roles.bicep' = {
  name: 'avd-platform-roles'
  params: {
    assignableScopes: assignableScopes
    nameToken: nameToken
    guidSeed: '${subscription().id}/${platformResourceGroupName}/${namePrefix}'
  }
}

// ---------------------------------------------------------------------------------------------------
// Platform resources
// ---------------------------------------------------------------------------------------------------
module identity 'modules/identity.bicep' = {
  name: 'avd-platform-identity'
  scope: platformRg
  params: {
    location: location
    nameToken: nameToken
    tags: tags
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'avd-platform-monitoring'
  scope: platformRg
  params: {
    location: location
    nameToken: nameToken
    tags: tags
    retentionInDays: logRetentionDays
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'avd-platform-keyvault'
  scope: platformRg
  params: {
    location: location
    vaultName: 'kv-${nameToken}'
    tags: tags
    softDeleteRetentionInDays: keyVaultRetentionDays
    workspaceId: monitoring.outputs.workspaceId
  }
}

module storage 'modules/storage.bicep' = {
  name: 'avd-platform-storage'
  scope: platformRg
  params: {
    location: location
    storageAccountName: storageAccountName
    deploymentContainerName: deploymentContainerName
    tags: tags
    workspaceId: monitoring.outputs.workspaceId
  }
}

// RBAC on the product's own resources must exist before the compute resources start using them.
module rbacPlatform 'modules/rbac-platform.bicep' = {
  name: 'avd-platform-rbac-platform'
  scope: platformRg
  params: {
    webPrincipalId: identity.outputs.fleetWeb.principalId
    watchdogPrincipalId: identity.outputs.watchdog.principalId
    storageAccountName: storage.outputs.name
    appInsightsName: monitoring.outputs.appInsightsName
    keyVaultName: keyVault.outputs.name
    workspaceName: monitoring.outputs.workspaceName
  }
}

module watchdogApp 'modules/functionapp.bicep' = {
  name: 'avd-platform-watchdog'
  scope: platformRg
  dependsOn: [
    rbacPlatform
  ]
  params: {
    location: location
    functionAppName: 'func-${nameToken}'
    planName: 'plan-func-${nameToken}'
    tags: tags
    identityId: identity.outputs.watchdog.id
    identityClientId: identity.outputs.watchdog.clientId
    storageAccountName: storage.outputs.name
    storageBlobEndpoint: storage.outputs.blobEndpoint
    deploymentContainerName: storage.outputs.deploymentContainerName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    workspaceId: monitoring.outputs.workspaceId
    watchdogSettings: watchdogSettings
  }
}

module webApp 'modules/webapp.bicep' = {
  name: 'avd-platform-web'
  scope: platformRg
  dependsOn: [
    rbacPlatform
  ]
  params: {
    location: location
    webAppName: 'app-${nameToken}'
    planName: 'plan-web-${nameToken}'
    tags: tags
    planSku: webPlanSku
    fleetIdentityId: identity.outputs.fleetWeb.id
    fleetIdentityClientId: identity.outputs.fleetWeb.clientId
    authIdentityId: identity.outputs.webAuth.id
    authIdentityClientId: identity.outputs.webAuth.clientId
    entraTenantId: entraTenantId
    entraAppClientId: entraAppClientId
    unauthenticatedClientAction: unauthenticatedClientAction
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    workspaceId: monitoring.outputs.workspaceId
    workspaceCustomerId: monitoring.outputs.workspaceCustomerId
    keyVaultUri: keyVault.outputs.vaultUri
    managedResourceGroupIds: managedResourceGroupIds
    enableWebActions: enableWebActions
  }
}

// ---------------------------------------------------------------------------------------------------
// Fleet RBAC: one deployment per managed resource group (may be in another subscription).
// ---------------------------------------------------------------------------------------------------
module rbacManaged 'modules/rbac-managed-rg.bicep' = [for rgId in managedResourceGroupIds: {
  name: 'avd-platform-rbac-${uniqueString(rgId)}'
  scope: resourceGroup(split(rgId, '/')[2], split(rgId, '/')[4])
  params: {
    webPrincipalId: identity.outputs.fleetWeb.principalId
    watchdogPrincipalId: identity.outputs.watchdog.principalId
    fleetReaderRoleId: roles.outputs.fleetReaderRoleId
    watchdogOperatorRoleId: roles.outputs.watchdogOperatorRoleId
    agentRestartRoleId: roles.outputs.agentRestartRoleId
    webActionsRoleId: roles.outputs.webActionsRoleId
    watchdogCanRemediate: watchdogCanRemediate
    enableAgentRestart: enableAgentRestart
    enableWebActions: enableWebActions
  }
}]

// ---------------------------------------------------------------------------------------------------
// Outputs (no secrets). Used by the post-deployment steps in infra/README.md.
// ---------------------------------------------------------------------------------------------------
@description('Resource group that holds the product.')
output platformResourceGroup string = platformRg.name

@description('Public URL of the web app.')
output webAppUrl string = 'https://${webApp.outputs.defaultHostName}'

@description('Redirect URI to register on the Entra app registration (Web platform).')
output entraRedirectUri string = 'https://${webApp.outputs.defaultHostName}/.auth/login/aad/callback'

@description('Values for the federated identity credential to add to the Entra app registration (README step 3).')
output entraFederatedCredential object = {
  name: 'avd-platform-web-easyauth'
  issuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
  subject: identity.outputs.webAuth.principalId
  audiences: [
    'api://AzureADTokenExchange'
  ]
}

output webAppName string = webApp.outputs.name
output functionAppName string = watchdogApp.outputs.name
output keyVaultName string = keyVault.outputs.name
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName

@description('Principal IDs of the runtime identities (for audit / access reviews).')
output identityPrincipalIds object = {
  webFleet: identity.outputs.fleetWeb.principalId
  watchdog: identity.outputs.watchdog.principalId
  webEasyAuthFederation: identity.outputs.webAuth.principalId
}
