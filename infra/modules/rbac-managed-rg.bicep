targetScope = 'resourceGroup'

// Role assignments on ONE managed resource group (a resource group that contains AVD host pools
// and/or their session-host VMs). Deployed once per entry of managedResourceGroupIds.
//
// principalType is set explicitly to 'ServicePrincipal' because the principals are freshly created
// managed identities (avoids lookups that can fail while the new service principal replicates).
// User-assigned identities are used so these assignments can exist before the compute resources:
// https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations

@description('Object (principal) ID of the web app fleet identity.')
param webPrincipalId string

@description('Object (principal) ID of the watchdog identity.')
param watchdogPrincipalId string

@description('Resource ID of the Fleet Reader custom role definition.')
param fleetReaderRoleId string

@description('Resource ID of the Watchdog Operator custom role definition.')
param watchdogOperatorRoleId string

@description('Resource ID of the Agent Restart (Run Command) custom role definition.')
param agentRestartRoleId string

@description('Resource ID of the Web Fleet Actions custom role definition.')
param webActionsRoleId string

@description('Watchdog may change things (drain/deallocate/start). When false the watchdog identity is read-only.')
param watchdogCanRemediate bool

@description('Grant the watchdog Run Command so it can restart the AVD agent. HIGH RISK.')
param enableAgentRestart bool

@description('Grant the web app write actions (drain, restart, deallocate, start).')
param enableWebActions bool

// Web app: always read-only on the fleet.
resource webReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, webPrincipalId, fleetReaderRoleId)
  properties: {
    roleDefinitionId: fleetReaderRoleId
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
    description: 'AVD Platform web app: read-only fleet view.'
  }
}

resource webActions 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableWebActions) {
  name: guid(resourceGroup().id, webPrincipalId, webActionsRoleId)
  properties: {
    roleDefinitionId: webActionsRoleId
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
    description: 'AVD Platform web app: admin-triggered fleet actions (enableWebActions=true).'
  }
}

// Watchdog: read-only in Report mode, operator in Remediate mode.
resource watchdogReadOnly 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!watchdogCanRemediate) {
  name: guid(resourceGroup().id, watchdogPrincipalId, fleetReaderRoleId)
  properties: {
    roleDefinitionId: fleetReaderRoleId
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
    description: 'AVD Platform watchdog (Report mode): read-only.'
  }
}

resource watchdogOperator 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (watchdogCanRemediate) {
  name: guid(resourceGroup().id, watchdogPrincipalId, watchdogOperatorRoleId)
  properties: {
    roleDefinitionId: watchdogOperatorRoleId
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
    description: 'AVD Platform watchdog (Remediate mode): drain, deallocate, start.'
  }
}

resource watchdogAgentRestart 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (watchdogCanRemediate && enableAgentRestart) {
  name: guid(resourceGroup().id, watchdogPrincipalId, agentRestartRoleId)
  properties: {
    roleDefinitionId: agentRestartRoleId
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
    description: 'AVD Platform watchdog: Run Command for agent restart (enableAgentRestart=true). HIGH RISK.'
  }
}
