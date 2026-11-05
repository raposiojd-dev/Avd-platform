// Web app (Next.js) on App Service for Linux, Node 22 LTS, with built-in authentication (Easy Auth)
// against Microsoft Entra ID using a FEDERATED MANAGED-IDENTITY CREDENTIAL - no client secret.
//
//   https://learn.microsoft.com/azure/app-service/configure-authentication-provider-aad#use-a-managed-identity-instead-of-a-secret
//   https://learn.microsoft.com/azure/app-service/overview-authentication-authorization#how-it-works
//
// Easy Auth only AUTHENTICATES. "By default, this feature provides only authentication, not
// authorization" - the app must still enforce app roles server-side (docs/adr/0004).

@description('Azure region.')
param location string

@description('Globally unique web app name.')
param webAppName string

@description('App Service plan name.')
param planName string

@description('Tags applied to every resource.')
param tags object

@description('App Service plan SKU. P0v3 is the smallest production-grade Linux SKU with alwaysOn and no shared-tenant throttling; B1 is acceptable for a trial.')
@allowed([
  'B1'
  'B2'
  'P0v3'
  'P1v3'
  'P1v2'
])
param planSku string = 'P0v3'

@description('Resource ID of the fleet identity (ARM access, Key Vault, Log Analytics).')
param fleetIdentityId string

@description('Client ID of the fleet identity. Used by the app via AZURE_CLIENT_ID.')
param fleetIdentityClientId string

@description('Resource ID of the identity used ONLY as the Easy Auth federated credential.')
param authIdentityId string

@description('Client ID of the Easy Auth identity. Set as OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID.')
param authIdentityClientId string

@description('builtin: the app does its own sign-in (settings entered on the Setup page). easyauth: App Service Authentication does it.')
@allowed([
  'builtin'
  'easyauth'
])
param authMode string = 'builtin'

@description('Only for easyauth: Microsoft Entra tenant ID (directory) that users sign in against.')
param entraTenantId string = ''

@description('Only for easyauth: client (application) ID of the Entra app registration for this web app.')
param entraAppClientId string = ''

@description('What Easy Auth does with an unauthenticated request. Both options REJECT anonymous traffic; AllowAnonymous is deliberately not offered.')
@allowed([
  'RedirectToLoginPage'
  'Return401'
])
param unauthenticatedClientAction string = 'RedirectToLoginPage'

@description('Paths that bypass authentication. Only the data-free liveness probe is excluded; every other path requires sign-in.')
param authExcludedPaths array = [
  '/api/health'
]

@description('Startup command. Next.js "output: standalone" builds are started with "node server.js".')
param appCommandLine string = 'node server.js'

@description('Optional health-check path (must be reachable by the platform; add it to authExcludedPaths if unauthenticated probes are required). Empty = disabled.')
param healthCheckPath string = '/api/health'

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Reject key-based telemetry; the web app then publishes with its fleet identity.')
param appInsightsEntraAuth bool = true

@description('Log Analytics workspace resource ID for diagnostic settings.')
param workspaceId string

@description('Log Analytics workspace customer ID (GUID, not a secret) - used by the app to query watchdog findings.')
param workspaceCustomerId string

@description('Key Vault URI (https://<name>.vault.<suffix>/).')
param keyVaultUri string

@description('Resource IDs of the managed resource groups the app may manage.')
param managedResourceGroupIds array

@description('Mirrors the enableWebActions deployment parameter so the UI can hide actions that RBAC would deny.')
param enableWebActions bool

@description('Watchdog mode, shown read-only on the Watchdog page. The real setting lives on the Function App.')
@allowed([
  'Report'
  'Remediate'
])
param watchdogMode string = 'Report'

// Subscription IDs the app reads fleet data from, derived from the managed resource group IDs
// ("/subscriptions/<id>/resourceGroups/<name>"). Azure RBAC still limits what is actually visible.
var managedSubscriptionIds = union(map(managedResourceGroupIds, rgId => split(rgId, '/')[2]), [])

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: planSku
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${fleetIdentityId}': {}
      '${authIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    // Key Vault references (if used later) resolve with the fleet identity, never the auth identity.
    keyVaultReferenceIdentity: fleetIdentityId
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: appCommandLine
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: empty(healthCheckPath) ? null : healthCheckPath
    }
  }
}

// Disable basic-auth (username/password) publishing credentials: deployments use Entra tokens.
resource ftpPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmPolicy 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'scm'
  properties: {
    allow: false
  }
}

var easyAuthSettings = authMode == 'easyauth' ? {
  // Easy Auth federated credential (NOT a secret: it is a managed identity client ID).
  OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID: authIdentityClientId
} : {}

var telemetryAuth = appInsightsEntraAuth ? {
  APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${fleetIdentityClientId};Authorization=AAD'
} : {}

resource appSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: webApp
  name: 'appsettings'
  properties: union({
    // --- Product contract (read by apps/web) -------------------------------------------------
    FLEET_PROVIDER: 'azure'
    AZURE_CLIENT_ID: fleetIdentityClientId
    AZURE_TENANT_ID: entraTenantId
    AVD_SUBSCRIPTION_IDS: join(managedSubscriptionIds, ',')
    ENABLE_WEB_ACTIONS: toLower(string(enableWebActions))
    WATCHDOG_MODE: watchdogMode
    KEY_VAULT_URI: keyVaultUri
    LOG_ANALYTICS_WORKSPACE_ID: workspaceCustomerId
    AUTH_MODE: authMode
    // --- Platform ------------------------------------------------------------------------------
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
    WEBSITE_RUN_FROM_PACKAGE: '1'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    NODE_ENV: 'production'
  }, telemetryAuth, easyAuthSettings)
}

// Only when App Service Authentication is chosen. In builtin mode the app signs people in itself, and this
// resource is absent so the first-run Setup page is reachable.
resource authSettings 'Microsoft.Web/sites/config@2024-04-01' = if (authMode == 'easyauth') {
  parent: webApp
  name: 'authsettingsV2'
  dependsOn: [
    appSettings
  ]
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: unauthenticatedClientAction
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: authExcludedPaths
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          // Single-tenant v2.0 issuer. environment() avoids hard-coding the cloud's login endpoint.
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
          clientId: entraAppClientId
          // Points at the app setting holding the identity's client ID -> federated credential, no secret.
          clientSecretSettingName: 'OVERRIDE_USE_MI_FIC_ASSERTION_CLIENTID'
        }
        validation: {
          allowedAudiences: [
            'api://${entraAppClientId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
      preserveUrlFragmentsForLogins: false
    }
    httpSettings: {
      requireHttps: true
      routes: {
        apiPrefix: '/.auth'
      }
      forwardProxy: {
        convention: 'NoProxy'
      }
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: webApp
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
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output id string = webApp.id
output name string = webApp.name
output defaultHostName string = webApp.properties.defaultHostName
