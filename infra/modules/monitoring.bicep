// Log Analytics workspace + workspace-based Application Insights.
// Local (key-based) ingestion is disabled by default so only Entra-authenticated telemetry is accepted:
// https://learn.microsoft.com/azure/azure-monitor/app/azure-ad-authentication#disable-local-authentication

@description('Azure region.')
param location string

@description('Short unique token used in resource names.')
param nameToken string

@description('Tags applied to every resource.')
param tags object

@description('Log Analytics retention in days (30-730).')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

@description('Reject key-based Application Insights ingestion. Requires every publisher to use Entra auth (APPLICATIONINSIGHTS_AUTHENTICATION_STRING + Monitoring Metrics Publisher).')
param disableLocalAuth bool = true

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${nameToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${nameToken}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: disableLocalAuth
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
// The workspace "customer id" is a non-secret GUID used by the Log Analytics query API.
output workspaceCustomerId string = workspace.properties.customerId
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
