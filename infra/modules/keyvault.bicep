// Key Vault: Azure RBAC authorisation (no access policies), soft delete, purge protection.
// Recommendations: https://learn.microsoft.com/azure/key-vault/general/secure-key-vault
// RBAC model:       https://learn.microsoft.com/azure/key-vault/general/rbac-guide
//
// WARNING: purge protection can never be disabled and the name of a soft-deleted vault cannot be
// reused until the retention period elapses
// (https://learn.microsoft.com/azure/key-vault/general/key-vault-recovery).
//
// The product does not need to store any secret in v0.1 (Easy Auth uses a federated managed-identity
// credential, storage and telemetry use Entra auth). The vault exists for future secrets and holds
// nothing by default.

@description('Azure region.')
param location string

@description('Globally unique vault name (3-24 chars, letters/digits/hyphens).')
@minLength(3)
@maxLength(24)
param vaultName string

@description('Tags applied to every resource.')
param tags object

@description('Tenant that owns the vault.')
param tenantId string = tenant().tenantId

@description('Soft-delete retention in days (7-90). Fixed at creation; cannot be changed afterwards.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 90

@description('Log Analytics workspace resource ID that receives diagnostic logs.')
param workspaceId string

@description('Public network access. Left Enabled so a first deployment works from anywhere; access is still Entra + RBAC only. See README "Private endpoints" for hardening.')
@allowed([
  'Enabled'
  'Disabled'
])
param publicNetworkAccess string = 'Enabled'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionInDays
    enablePurgeProtection: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: vault
  properties: {
    workspaceId: workspaceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output id string = vault.id
output name string = vault.name
output vaultUri string = vault.properties.vaultUri
