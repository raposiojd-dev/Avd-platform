targetScope = 'resourceGroup'

// Role assignments on the product's OWN resources (platform resource group), each at resource
// scope - never at resource-group or subscription scope.
//
// Built-in role IDs, all verified on Microsoft Learn:
//   Storage Blob Data Owner           b7e6dc6d-f1e8-4753-8033-0f276bb0955b  } required by the Flex Consumption
//   Storage Queue Data Contributor    974c5e8b-45b9-4653-ba55-5f855dd0fb88  } host with identity-based storage:
//   Storage Table Data Contributor    0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3  } azure-quickstart-templates sample
//   Monitoring Metrics Publisher      3913510d-42f4-4e42-8a64-420c390055eb    https://learn.microsoft.com/azure/azure-functions/functions-app-settings#applicationinsights_authentication_string
//   Key Vault Secrets User            4633458b-17de-408a-b874-0445c86b69e6    https://learn.microsoft.com/azure/key-vault/general/rbac-guide#azure-built-in-roles-for-key-vault-data-plane-operations
//   Log Analytics Data Reader         3b03c2da-16b3-4a49-8834-0f8130efdd3b    https://learn.microsoft.com/azure/role-based-access-control/built-in-roles#monitor

@description('Object ID of the web app fleet identity.')
param webPrincipalId string

@description('Object ID of the watchdog identity.')
param watchdogPrincipalId string

@description('Name of the watchdog storage account.')
param storageAccountName string

@description('Name of the Application Insights component.')
param appInsightsName string

@description('Name of the Key Vault.')
param keyVaultName string

@description('Name of the Log Analytics workspace.')
param workspaceName string

var roleBlobOwner = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var roleQueueContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '974c5e8b-45b9-4653-ba55-5f855dd0fb88')
var roleTableContributor = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
var roleMetricsPublisher = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
var roleKeyVaultSecretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var roleLogAnalyticsDataReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3b03c2da-16b3-4a49-8834-0f8130efdd3b')

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

// --- Watchdog Function: its own storage account + telemetry --------------------------------
resource watchdogBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, watchdogPrincipalId, roleBlobOwner)
  scope: storage
  properties: {
    roleDefinitionId: roleBlobOwner
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource watchdogQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, watchdogPrincipalId, roleQueueContributor)
  scope: storage
  properties: {
    roleDefinitionId: roleQueueContributor
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource watchdogTable 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, watchdogPrincipalId, roleTableContributor)
  scope: storage
  properties: {
    roleDefinitionId: roleTableContributor
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource watchdogTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, watchdogPrincipalId, roleMetricsPublisher)
  scope: appInsights
  properties: {
    roleDefinitionId: roleMetricsPublisher
    principalId: watchdogPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// --- Web app: telemetry, Key Vault secrets (read), watchdog findings (query) ----------------
resource webTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, webPrincipalId, roleMetricsPublisher)
  scope: appInsights
  properties: {
    roleDefinitionId: roleMetricsPublisher
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource webSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, webPrincipalId, roleKeyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: roleKeyVaultSecretsUser
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource webLogQuery 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workspace.id, webPrincipalId, roleLogAnalyticsDataReader)
  scope: workspace
  properties: {
    roleDefinitionId: roleLogAnalyticsDataReader
    principalId: webPrincipalId
    principalType: 'ServicePrincipal'
  }
}
