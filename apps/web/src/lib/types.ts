export type AgentStatus =
  | "Available"
  | "Unavailable"
  | "NoHeartbeat"
  | "NeedsAssistance"
  | "Shutdown"
  | "Upgrading"
  | "UpgradeFailed"
  | "DomainTrustRelationshipLost"
  | "SxSStackListenerNotReady"
  | "FSLogixNotHealthy"
  | "InitializationFailed"
  | "Disconnected"
  | "Unknown";

/** VM power state as reported by Azure Compute, lower-case, without the "PowerState/" prefix. "" means none reported. */
export type PowerState = "running" | "starting" | "stopping" | "stopped" | "deallocating" | "deallocated" | "" | string;

export interface SessionHost {
  id: string; // stable id (ARM resource id of the session host)
  name: string; // short host name
  poolId: string;
  poolName: string;
  vmResourceId: string | null;
  vmSize: string | null;
  agentStatus: AgentStatus;
  agentVersion: string | null;
  powerState: PowerState;
  hibernated: boolean; // Compute reports HibernationState/Hibernated
  hibernationEnabled: boolean;
  provisioningState: string; // "succeeded" | "failed" | "updating" | ...
  lastPowerChangeUtc: string | null; // when the VM's last operation finished
  lastHeartBeatUtc: string | null;
  sessions: number;
  drained: boolean; // allowNewSession === false
  excludedFromWatchdog: boolean;
}

export type HealthState =
  | "healthy"
  | "draining"
  | "hibernated" // normal: deallocated + hibernated
  | "off" // normal: deallocated / stopped
  | "starting" // running but inside the grace period
  | "stuck" // the problem we exist to catch
  | "degraded"; // agent reports a problem that is not a hibernate-resume issue

export type StuckReason = "blank-power-state" | "agent-unavailable-after-resume" | "provisioning-failed";

export interface HostHealth {
  state: HealthState;
  reason: StuckReason | null;
  /** One plain sentence for the UI. */
  summary: string;
  /** What the operator should do next, or null when nothing is needed. */
  advice: string | null;
}

export interface HostPool {
  id: string;
  name: string;
  type: "Pooled" | "Personal";
  subscriptionId: string;
  hasScalingPlan: boolean;
  startVmOnConnect: boolean;
  maxSessionLimit: number | null;
}

export interface Fleet {
  generatedAtUtc: string;
  source: "demo" | "azure";
  pools: HostPool[];
  hosts: SessionHost[];
  /** Hourly availability history per pool, newest last, 0..100 (demo data or from Log Analytics). */
  history: Record<string, number[]>;
  warnings: string[];
}

export type HostAction = "drain" | "undrain" | "restart" | "deallocate" | "start";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type Role = "Reader" | "Operator" | "Admin";

export interface Principal {
  id: string;
  name: string;
  roles: Role[];
}

export interface AuditEntry {
  id: string;
  atUtc: string;
  actor: string;
  action: string;
  target: string;
  outcome: "success" | "denied" | "error";
  detail: string;
}
