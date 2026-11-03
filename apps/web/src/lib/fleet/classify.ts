import type { HostHealth, SessionHost } from "../types";

/** Minutes a freshly resumed VM gets to re-register its AVD agent before we call it stuck.
 *  Microsoft documents ~5 minutes for RDAgentBootLoader and RDAgent to reach Running after resume:
 *  https://learn.microsoft.com/troubleshoot/azure/virtual-desktop/troubleshoot-autoscale#issue-3-session-hosts-unavailable-after-hibernate-resume */
export const RESUME_GRACE_MINUTES = 10;

const UNHEALTHY_AGENT = new Set(["Unavailable", "NoHeartbeat", "NeedsAssistance"]);
const AGENT_PROBLEMS = new Set([
  "UpgradeFailed",
  "DomainTrustRelationshipLost",
  "SxSStackListenerNotReady",
  "FSLogixNotHealthy",
  "InitializationFailed",
]);

function minutesSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 60000;
}

/**
 * Decides what a session host's state really means. Order matters and mirrors the unattended watchdog
 * (tools/Invoke-AvdHibernateWatchdog.ps1): the VM's real power state is checked before the AVD agent status,
 * so a host a Scaling Plan deallocated or hibernated is never mistaken for a failure, and a host whose VM
 * is on but whose agent never came back is never mistaken for a normal scale-down.
 */
export function classifyHost(h: SessionHost, now: Date = new Date()): HostHealth {
  const power = (h.powerState ?? "").toLowerCase();
  const sinceOp = minutesSince(h.lastPowerChangeUtc, now);
  const pastGrace = sinceOp === null || sinceOp >= RESUME_GRACE_MINUTES;

  if (h.provisioningState.toLowerCase().startsWith("failed")) {
    return {
      state: "stuck",
      reason: "provisioning-failed",
      summary: "The VM's last operation failed.",
      advice: "Reapply the VM, then deallocate and start it.",
    };
  }

  if (power === "deallocated" || power === "deallocating" || power === "stopped" || power === "stopping") {
    if (h.hibernated) {
      return { state: "hibernated", reason: null, summary: "Hibernated by the scaling plan. This is normal.", advice: null };
    }
    return { state: "off", reason: null, summary: "Powered off to save cost. This is normal.", advice: null };
  }

  if (power === "") {
    // No power state at all. Azure can briefly omit it while a VM is being created or updated, so only
    // call it stuck once it has persisted past the grace period and provisioning looks finished.
    if (!pastGrace) {
      return { state: "starting", reason: null, summary: "Waiting for Azure to report a power state.", advice: null };
    }
    if (h.agentStatus === "Available") {
      return { state: "healthy", reason: null, summary: "Serving users (Azure is not reporting a power state).", advice: null };
    }
    return {
      state: "stuck",
      reason: "blank-power-state",
      summary: "Azure reports no power state and the agent is unavailable. Typical of a failed hibernate resume.",
      advice: "Deallocate the VM, then start it for a clean boot.",
    };
  }

  if (power === "running" || power === "starting") {
    if (UNHEALTHY_AGENT.has(h.agentStatus)) {
      if (!pastGrace) {
        return { state: "starting", reason: null, summary: "Just started. Giving the agent time to register.", advice: null };
      }
      return {
        state: "stuck",
        reason: "agent-unavailable-after-resume",
        summary: `The VM is running but the AVD agent has been ${h.agentStatus} for over ${RESUME_GRACE_MINUTES} minutes. Typical of a failed hibernate resume.`,
        advice: "Deallocate the VM, then start it for a clean boot.",
      };
    }
    if (AGENT_PROBLEMS.has(h.agentStatus)) {
      return {
        state: "degraded",
        reason: null,
        summary: `The AVD agent reports ${h.agentStatus}.`,
        advice: "Check the agent health details on the host.",
      };
    }
    if (h.drained) {
      return { state: "draining", reason: null, summary: "Drained: not accepting new sessions.", advice: null };
    }
    return { state: "healthy", reason: null, summary: "Healthy and accepting sessions.", advice: null };
  }

  return { state: "degraded", reason: null, summary: `VM power state is ${power}.`, advice: "Check the VM in the Azure portal." };
}

export function summarize(hosts: SessionHost[], now: Date = new Date()) {
  const counts = { healthy: 0, draining: 0, hibernated: 0, off: 0, starting: 0, stuck: 0, degraded: 0 };
  for (const h of hosts) counts[classifyHost(h, now).state]++;
  return { total: hosts.length, ...counts };
}
