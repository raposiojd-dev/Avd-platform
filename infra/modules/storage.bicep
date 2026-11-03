// Storage account for the watchdog Function (host state + Flex Consumption deployment package).
//
// Shared-key access is DISABLED: the Function host and the Flex deployment service authenticate
// with a managed identity. Flex Consumption supports this:
//   https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan
//   (and the Microsoft sample template: azure-quickstart-templates/quickstarts/microsoft.web/function-app-flex-managed-identities)
// Consequence: nobody - including operators in the portal - can use account keys or SAS signed with them.

@description('Azure region.')
param location string

@description('Globally unique storage account name (3-24 lowercase letters/digits).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Name of the blob container that holds the Function deployment package.')
param deploymentContainerName string

@description('Tags applied to every resource.')
param tags object

@description('Storage redundancy.')
@allowed([
  'Standard_LRS'
  'Standard_ZRS'
  'Standard_GRS'
])
param skuName string = 'Standard_LRS'

@description('Log Analytics workspace resource ID that receives diagnostic logs.')
param workspaceId string

@description('Public network access. Enabled by default so deployment works anywhere; access still requires Entra + RBAC. See README for private-endpoint hardening.')
@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Blob data-plane audit trail (read/write/delete) to Log Analytics.
resource blobDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: blobService
  properties: {
    workspaceId: workspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'Transaction'
        enabled: true
      }
    ]
  }
}

output id string = account.id
output name string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
output deploymentContainerName string = deploymentContainer.name
output blobServiceId string = blobService.id
