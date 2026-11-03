targetScope = 'subscription'

// Custom Azure RBAC role definitions. These are the ONLY Azure permissions the product's runtime
// identities receive on the customer's AVD fleet. They are assigned (see rbac-managed-rg.bicep) only
// on the managed resource groups the customer lists - never on the subscription.
//
// Guidance followed:
//   - Use custom roles when built-ins are broader than needed; assign at the narrowest scope:
//     https://learn.microsoft.com/azure/role-based-access-control/role-definitions#assignablescopes
//   - AssignableScopes may not contain wildcards or the root scope:
//     https://learn.microsoft.com/azure/role-based-access-control/custom-roles#custom-role-limits
//
// Role-definition names must be unique per Entra tenant, so a short deployment token is appended.
//
// Source of truth: this file. tools/avd-hibernate-watchdog-role.json is the earlier hand-assignable
// version; it is superseded by roleWatchdogOperator + roleAgentRestart below.

@description('Subscription scopes (e.g. "/subscriptions/<id>") in which these roles may be assigned.')
param assignableScopes array

@description('Short token that makes role names unique within the tenant.')
param nameToken string

@description('Stable seed so role-definition GUIDs are deterministic per deployment.')
param guidSeed string

var readActions = [
  // Host pools, session hosts, user sessions, app groups, workspaces, scaling plans (read only).
  // Same DesktopVirtualization read surface as the built-in "Desktop Virtualization Reader"
  // (https://learn.microsoft.com/azure/virtual-desktop/rbac#desktop-virtualization-reader)
  // WITHOUT its Microsoft.Authorization/*/read and Microsoft.Support/* entries.
  'Microsoft.DesktopVirtualization/*/read'
  // VM model + instance view (power state, provisioning timestamps).
  'Microsoft.Compute/virtualMachines/read'
  'Microsoft.Compute/virtualMachines/instanceView/read'
  // Needed to enumerate the managed resource groups themselves.
  'Microsoft.Resources/subscriptions/resourceGroups/read'
]

resource roleFleetReader 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(guidSeed, 'fleet-reader')
  properties: {
    roleName: 'AVD Platform - Fleet Reader (${nameToken})'
    description: 'Read-only view of AVD host pools, session hosts, user sessions and the backing virtual machines. Assigned to the web app identity on managed resource groups only.'
    type: 'CustomRole'
    permissions: [
      {
        actions: readActions
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: assignableScopes
  }
}

resource roleWatchdogOperator 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(guidSeed, 'watchdog-operator')
  properties: {
    roleName: 'AVD Platform - Watchdog Operator (${nameToken})'
    description: 'Fleet read plus drain/undrain a session host and deallocate/start its VM. Assigned to the watchdog identity only when WATCHDOG_MODE is Remediate.'
    type: 'CustomRole'
    permissions: [
      {
        actions: concat(readActions, [
          // Drain / undrain (Update-AzWvdSessionHost -AllowNewSession).
          'Microsoft.DesktopVirtualization/hostpools/sessionhosts/write'
          // Stop-AzVM (deallocate) and Start-AzVM.
          'Microsoft.Compute/virtualMachines/deallocate/action'
          'Microsoft.Compute/virtualMachines/start/action'
        ])
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: assignableScopes
  }
}

resource roleAgentRestart 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(guidSeed, 'agent-restart-runcommand')
  properties: {
    roleName: 'AVD Platform - Agent Restart via Run Command (${nameToken})'
    description: 'OPTIONAL and HIGH RISK. Allows Run Command (arbitrary script as SYSTEM) on session host VMs so the watchdog can restart RDAgentBootLoader. Assigned only when enableAgentRestart is true. Combine with Watchdog Operator.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Compute/virtualMachines/runCommand/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: assignableScopes
  }
}

resource roleWebActions 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(guidSeed, 'web-fleet-actions')
  properties: {
    roleName: 'AVD Platform - Web Fleet Actions (${nameToken})'
    description: 'Write actions the web app performs for administrators: drain/undrain, restart, deallocate, start. Additive to Fleet Reader. Assigned only when enableWebActions is true.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.DesktopVirtualization/hostpools/sessionhosts/write'
          'Microsoft.Compute/virtualMachines/restart/action'
          'Microsoft.Compute/virtualMachines/deallocate/action'
          'Microsoft.Compute/virtualMachines/start/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: assignableScopes
  }
}

output fleetReaderRoleId string = roleFleetReader.id
output watchdogOperatorRoleId string = roleWatchdogOperator.id
output agentRestartRoleId string = roleAgentRestart.id
output webActionsRoleId string = roleWebActions.id
