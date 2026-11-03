import { describe, expect, it } from "vitest";
import { classifyHost, RESUME_GRACE_MINUTES } from "@/lib/fleet/classify";
import type { SessionHost } from "@/lib/types";

const NOW = new Date("2026-11-03T06:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

function host(over: Partial<SessionHost>): SessionHost {
  return {
    id: "h1", name: "h1", poolId: "p", poolName: "pool", vmResourceId: "vm", vmSize: "Standard_D4s_v5",
    agentStatus: "Available", agentVersion: "1", powerState: "running", hibernated: false, hibernationEnabled: true,
    provisioningState: "succeeded", lastPowerChangeUtc: ago(120), lastHeartBeatUtc: ago(1), sessions: 0, drained: false,
    excludedFromWatchdog: false, ...over,
  };
}

describe("classifyHost", () => {
  it("treats a hibernated, deallocated VM as normal", () => {
    const r = classifyHost(host({ powerState: "deallocated", hibernated: true, agentStatus: "Unavailable" }), NOW);
    expect(r.state).toBe("hibernated");
    expect(r.advice).toBeNull();
  });

  it("treats a deallocated, non-hibernated VM as off", () => {
    expect(classifyHost(host({ powerState: "deallocated", agentStatus: "Shutdown" }), NOW).state).toBe("off");
  });

  it("flags a running VM whose agent stayed unavailable past the grace period", () => {
    const r = classifyHost(host({ agentStatus: "NoHeartbeat", lastPowerChangeUtc: ago(RESUME_GRACE_MINUTES + 5) }), NOW);
    expect(r.state).toBe("stuck");
    expect(r.reason).toBe("agent-unavailable-after-resume");
  });

  it("does not flag a VM that only just started", () => {
    expect(classifyHost(host({ agentStatus: "Unavailable", lastPowerChangeUtc: ago(2) }), NOW).state).toBe("starting");
  });

  it("flags a blank power state with an unavailable agent", () => {
    const r = classifyHost(host({ powerState: "", agentStatus: "Unavailable" }), NOW);
    expect(r.state).toBe("stuck");
    expect(r.reason).toBe("blank-power-state");
  });

  it("does not flag a blank power state on a host that is serving users", () => {
    expect(classifyHost(host({ powerState: "", agentStatus: "Available" }), NOW).state).toBe("healthy");
  });

  it("does not flag a blank power state inside the grace period (VM being created or updated)", () => {
    expect(classifyHost(host({ powerState: "", agentStatus: "Unavailable", lastPowerChangeUtc: ago(1) }), NOW).state).toBe("starting");
  });

  it("flags a failed provisioning state", () => {
    expect(classifyHost(host({ provisioningState: "failed" }), NOW).state).toBe("stuck");
  });

  it("reports a drained, healthy host as draining", () => {
    expect(classifyHost(host({ drained: true }), NOW).state).toBe("draining");
  });

  it("reports agent problems that are not resume issues as degraded", () => {
    expect(classifyHost(host({ agentStatus: "FSLogixNotHealthy" }), NOW).state).toBe("degraded");
  });

  it("never calls an unreadable power state stuck", () => {
    expect(classifyHost(host({ powerState: "unreadable", agentStatus: "Unavailable" }), NOW).state).toBe("degraded");
  });
});
