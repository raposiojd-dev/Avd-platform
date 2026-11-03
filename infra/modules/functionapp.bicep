// Watchdog Function App: PowerShell 7.4 on Linux, Flex Consumption (FC1).
//
// Why Flex Consumption: Microsoft calls it "the recommended serverless hosting plan for Azure Functions",
// and it supports identity-based storage, virtual network integration and PowerShell 7.4:
// https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan
// Linux Consumption is on the path to retirement (Node 22 is its last Node version, per
// https://learn.microsoft.com/azure/azure-functions/functions-versions), so it is not used.
//
// Flex-specific rules honoured here:
//   * runtime/scale/deployment live in functionAppConfig - NOT in FUNCTIONS_WORKER_RUNTIME /
//     WEBSITE_RUN_FROM_PACKAGE app settings ("Don't set the WEBSITE_RUN_FROM_PACKAGE app setting"):
//     https://learn.microsoft.com/azure/azure-functions/deployment-zip-push#deploy-a-package
//   * PowerShell managed dependencies are NOT supported - modules must be bundled in the package:
//     https://learn.microsoft.com/azure/azure-functions/functions-reference-powershell#dependency-management
//   * WEBSITE_TIME_ZONE is unsupported, so cron schedules are UTC.

@description('Azure region. Must support Flex Consumption: https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to#view-currently-supported-regions')
param location string

@description('Globally unique Function App name.')
param functionAppName string

@description('Flex Consumption plan name.')
param planName string

@description('Tags applied to every resource.')
param tags object

@description('Resource ID of the watchdog user-assigned identity.')
param identityId string

@description('Client ID of the watchdog user-assigned identity.')
param identityClientId string

@description('Storage account name used for host state and the deployment package.')
param storageAccountName string

@description('Blob endpoint of that storage account (https://<account>.blob.<suffix>/).')
param storageBlobEndpoint string

@description('Blob container that holds the deployment package.')
param deploymentContainerName string

@description('Application Insights connection string (not a secret; ingestion requires Entra auth).')
param appInsightsConnectionString string

@description('Log Analytics workspace resource ID for diagnostic settings.')
param workspaceId string

@description('PowerShell runtime version on Flex Consumption.')
@allowed([
  '7.4'
])
param powerShellVersion string = '7.4'

@description('Maximum scale-out instances (Flex range 1-1000). A single timer function never needs more than a few.')
@minValue(1)
@maxValue(1000)
param maximumInstanceCount int = 10

@description('Instance memory in MB.')
@allowed([
  512
  2048
  4096
])
param instanceMemoryMB int = 2048

@description('Watchdog behaviour settings, already validated by main.bicep.')
param watchdogSettings object

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}${deploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: identityId
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'powershell'
        version: powerShellVersion
      }
    }
  }
}

// App settings. Everything environment-specific is supplied at deployment time; nothing here is a
// secret. Storage and telemetry use the managed identity (no keys, no connection strings with keys).
resource appSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: union({
    AzureWebJobsStorage__accountName: storageAccountName
    AzureWebJobsStorage__credential: 'managedidentity'
    AzureWebJobsStorage__clientId: identityClientId
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
    APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${identityClientId};Authorization=AAD'
    // Read by profile.ps1 to pick the user-assigned identity for Connect-AzAccount -Identity.
    AZURE_CLIENT_ID: identityClientId
  }, watchdogSettings)
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: functionApp
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

output id string = functionApp.id
output name string = functionApp.name
output defaultHostName string = functionApp.properties.defaultHostName
