import type { ActionResult, Fleet, HostAction, HostPool, SessionHost, UnregisteredVm, UserSession } from "../types";
import type { FleetProvider } from "./provider";

// Deterministic fake estate for demos, screenshots and tests. Every name is fictional.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const SUB = "00000000-0000-0000-0000-000000000000";
const poolDefs: { name: string; type: HostPool["type"]; hosts: number; vm: string; scaling: boolean; svoc: boolean; max: number | null }[] = [
  { name: "hp-finance-pooled", type: "Pooled", hosts: 14, vm: "Standard_D8s_v5", scaling: true, svoc: false, max: 12 },
  { name: "hp-engineering-personal", type: "Personal", hosts: 12, vm: "Standard_D16s_v5", scaling: true, svoc: true, max: null },
  { name: "hp-contact-centre", type: "Pooled", hosts: 12, vm: "Standard_D4s_v5", scaling: true, svoc: false, max: 16 },
  { name: "hp-shared-apps", type: "Pooled", hosts: 8, vm: "Standard_D8s_v5", scaling: false, svoc: false, max: 10 },
];

interface DemoState {
  fleet: Fleet;
  readyAt: Map<string, number>; // host id -> epoch ms when the agent registers after a start/restart
}

const g = globalThis as unknown as { __demo?: DemoState };

const mins = (n: number) => new Date(Date.now() - n * 60000).toISOString();

function build(): DemoState {
  const rand = rng(20261103);
  const pools: HostPool[] = poolDefs.map((p) => ({
    id: `/subscriptions/${SUB}/resourceGroups/rg-avd-demo/providers/Microsoft.DesktopVirtualization/hostPools/${p.name}`,
    name: p.name,
    type: p.type,
    subscriptionId: SUB,
    hasScalingPlan: p.scaling,
    startVmOnConnect: p.svoc,
    maxSessionLimit: p.max,
  }));

  const hosts: SessionHost[] = [];
  poolDefs.forEach((p, pi) => {
    const pool = pools[pi]!;
    for (let i = 0; i < p.hosts; i++) {
      const name = `${p.name.replace("hp-", "").slice(0, 7).replace(/-+$/, "")}-${String(i + 1).padStart(2, "0")}`;
      const roll = rand();
      const base: SessionHost = {
        id: `${pool.id}/sessionHosts/${name}.contoso.local`,
        name,
        poolId: pool.id,
        poolName: pool.name,
        vmResourceId: `/subscriptions/${SUB}/resourceGroups/rg-avd-demo/providers/Microsoft.Compute/virtualMachines/${name}`,
        vmSize: p.vm,
        agentStatus: "Available",
        agentVersion: "1.0.9742.1500",
        powerState: "running",
        hibernated: false,
        hibernationEnabled: p.scaling,
        provisioningState: "succeeded",
        lastPowerChangeUtc: mins(60 * (6 + Math.floor(rand() * 40))),
        lastHeartBeatUtc: mins(Math.floor(rand() * 2)),
        sessions: p.type === "Personal" ? (rand() > 0.35 ? 1 : 0) : Math.floor(rand() * 9),
        drained: false,
        excludedFromWatchdog: false,
      };
      if (roll < 0.22 && p.scaling) {
        Object.assign(base, { powerState: "deallocated", hibernated: true, agentStatus: "Unavailable", sessions: 0, lastHeartBeatUtc: mins(60 * 9) });
      } else if (roll < 0.34) {
        Object.assign(base, { powerState: "deallocated", hibernated: false, agentStatus: "Shutdown", sessions: 0, lastHeartBeatUtc: mins(60 * 14) });
      } else if (roll < 0.4) {
        Object.assign(base, { drained: true, sessions: Math.floor(rand() * 3) });
      }
      hosts.push(base);
    }
  });

  // Hand-placed storylines so every screen has something to show.
  const byName = (n: string) => hosts.find((h) => h.name === n)!;
  const a = hosts.filter((h) => h.poolName === "hp-finance-pooled");
  const b = hosts.filter((h) => h.poolName === "hp-engineering-personal");
  const c = hosts.filter((h) => h.poolName === "hp-contact-centre");
  const stuck1 = a[3]!; // running, agent never came back after resume
  Object.assign(stuck1, { powerState: "running", hibernated: false, agentStatus: "NoHeartbeat", sessions: 0, drained: false, lastPowerChangeUtc: mins(47), lastHeartBeatUtc: mins(46) });
  const stuck2 = b[5]!; // blank power state
  Object.assign(stuck2, { powerState: "", hibernated: false, agentStatus: "Unavailable", sessions: 0, drained: false, lastPowerChangeUtc: mins(95), lastHeartBeatUtc: mins(94) });
  const starting = c[2]!; // just resumed, still inside the grace period
  Object.assign(starting, { powerState: "running", hibernated: false, agentStatus: "Unavailable", sessions: 0, drained: false, lastPowerChangeUtc: mins(3), lastHeartBeatUtc: mins(40) });
  const degraded = c[7]!;
  Object.assign(degraded, { powerState: "running", agentStatus: "FSLogixNotHealthy", drained: false });
  const excluded = a[9]!;
  Object.assign(excluded, { excludedFromWatchdog: true });
  void byName;

  const unregistered: UnregisteredVm[] = [
    { id: "vm-build-01", name: "imgbuild-01", resourceGroup: "rg-avd-demo", vmSize: "Standard_D4s_v5", powerState: "deallocated" },
    { id: "vm-fs-01", name: "fslogix-fs-01", resourceGroup: "rg-avd-demo", vmSize: "Standard_D4s_v5", powerState: "running" },
    { id: "vm-old-07", name: "finance-07-old", resourceGroup: "rg-avd-demo", vmSize: "Standard_D8s_v5", powerState: "stopped" },
  ];

  const history: Record<string, number[]> = {};
  pools.forEach((p, i) => {
    const r = rng(77 + i);
    let v = 96 - i;
    history[p.id] = Array.from({ length: 24 }, (_, k) => {
      v = Math.max(78, Math.min(100, v + (r() - 0.48) * 4));
      if (p.name === "hp-finance-pooled" && k > 18) v -= 3.2; // a visible dip where the stuck host appeared
      return Math.round(v * 10) / 10;
    });
  });

  return {
    fleet: { generatedAtUtc: new Date().toISOString(), source: "demo", pools, hosts, unregistered, history, warnings: [] },
    readyAt: new Map(),
  };
}

function state(): DemoState {
  return (g.__demo ??= build());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const demoProvider: FleetProvider = {
  source: "demo",

  async getSessions() {
    const s = state();
    const r = rng(4242);
    const first = ["Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Ivy", "Leo", "Ruby", "Jack", "Ella", "Oscar"];
    const last = ["Nguyen", "Smith", "Patel", "Jones", "Kim", "Brown", "Singh", "Taylor", "Wong", "Evans"];
    const sessions: UserSession[] = [];
    for (const h of s.fleet.hosts) {
      for (let i = 0; i < h.sessions; i++) {
        const disc = r() < 0.35;
        sessions.push({
          id: `${h.id}/userSessions/${i + 1}`,
          user: `${first[Math.floor(r() * first.length)]}.${last[Math.floor(r() * last.length)]}@contoso.example`,
          hostName: h.name, hostId: h.id, poolName: h.poolName,
          state: disc ? "disconnected" : "active", rawState: disc ? "Disconnected" : "Active",
          startedUtc: new Date(Date.now() - Math.floor(r() * 9 * 3600_000)).toISOString(), application: "Desktop",
        });
      }
    }
    return { sessions, warnings: [] as string[] };
  },

  async getFleet(): Promise<Fleet> {
    const s = state();
    const now = Date.now();
    for (const [id, at] of s.readyAt) {
      if (now >= at) {
        const h = s.fleet.hosts.find((x) => x.id === id);
        if (h && h.powerState === "running") {
          h.agentStatus = "Available";
          h.lastHeartBeatUtc = new Date().toISOString();
        }
        s.readyAt.delete(id);
      }
    }
    return { ...s.fleet, generatedAtUtc: new Date().toISOString(), hosts: s.fleet.hosts.map((h) => ({ ...h })) };
  },

  async applyAction(hostId: string, action: HostAction): Promise<ActionResult> {
    const s = state();
    const h = s.fleet.hosts.find((x) => x.id === hostId);
    if (!h) return { ok: false, message: "Host not found." };
    await sleep(350); // feels like a real call
    switch (action) {
      case "drain":
        h.drained = true;
        return { ok: true, message: `${h.name} is drained. New sessions go elsewhere.` };
      case "undrain":
        h.drained = false;
        return { ok: true, message: `${h.name} accepts new sessions again.` };
      case "deallocate":
        Object.assign(h, { powerState: "deallocated", hibernated: false, agentStatus: "Shutdown", sessions: 0, provisioningState: "succeeded", lastPowerChangeUtc: new Date().toISOString() });
        return { ok: true, message: `${h.name} is deallocated.` };
      case "start":
      case "restart":
        Object.assign(h, { powerState: "running", hibernated: false, agentStatus: "Unavailable", provisioningState: "succeeded", lastPowerChangeUtc: new Date().toISOString() });
        s.readyAt.set(h.id, Date.now() + 25000);
        return { ok: true, message: `${h.name} is ${action === "start" ? "starting" : "restarting"}. It should register in about 25 seconds.` };
    }
  },
};
