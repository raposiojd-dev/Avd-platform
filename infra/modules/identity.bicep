// Three user-assigned managed identities with deliberately separate blast radii.
//
//   fleetWeb    - the web app's identity for Azure Resource Manager reads (and, only when
//                 enabled, fleet actions), Key Vault, Log Analytics queries.
//   watchdog    - the watchdog Function's identity: fleet operations, its own storage account,
//                 telemetry publishing.
//   webAuth     - used ONLY as the federated credential for App Service Authentication
//                 (Easy Auth). It is granted NO Azure RBAC role anywhere. Microsoft requires
//                 that this identity is assigned only to the app it authenticates:
//                 https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad#use-a-managed-identity-instead-of-a-secret
//
// User-assigned identities are used (rather than system-assigned) so role assignments can exist
// before the compute resources do, which avoids RBAC propagation races during first deployment:
// https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations

@description('Azure region.')
param location string

@description('Short unique token used in resource names.')
param nameToken string

@description('Tags applied to every resource.')
param tags object

resource fleetWeb 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${nameToken}-web'
  location: location
  tags: tags
}

resource watchdog 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${nameToken}-watchdog'
  location: location
  tags: tags
}

resource webAuth 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${nameToken}-webauth'
  location: location
  tags: tags
}

output fleetWeb object = {
  id: fleetWeb.id
  name: fleetWeb.name
  principalId: fleetWeb.properties.principalId
  clientId: fleetWeb.properties.clientId
}

output watchdog object = {
  id: watchdog.id
  name: watchdog.name
  principalId: watchdog.properties.principalId
  clientId: watchdog.properties.clientId
}

output webAuth object = {
  id: webAuth.id
  name: webAuth.name
  principalId: webAuth.properties.principalId
  clientId: webAuth.properties.clientId
}
