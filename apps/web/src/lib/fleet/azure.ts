import { DefaultAzureCredential } from "@azure/identity";
import { getEnv } from "../env";
import type { ActionResult, AgentStatus, Fleet, HostAction, HostPool, SessionHost, UnregisteredVm, UserSession } from "../types";
import type { FleetProvider } from "./provider";

// Live provider. Read path uses Azure Resource Graph (one query per object type, paged) plus the Compute
// "statusOnly" list for VM power state. Write path (drain/start/restart/deallocate) is gated by ENABLE_WEB_ACTIONS
// and by the managed identity's RBAC. STATUS: written against the documented APIs, NOT yet exercised against a
// real tenant. Run it with a Reader identity first.
//   Resource Graph: https://learn.microsoft.com/azure/governance/resource-graph/overview
//   VM list statusOnly: https://learn.microsoft.com/rest/api/compute/virtual-machines/list-all
//   Session host update: https://learn.microsoft.com/rest/api/desktopvirtualization/session-hosts/update
//   Throttling: https://learn.microsoft.com/azure/azure-resource-manager/management/request-limits-and-throttling

const ARM = "https://management.azure.com";
const WATCHDOG_EXCLUDE_TAG = "avd-watchdog-exclude";
const CACHE_MS = 20_000;

let credential: DefaultAzureCredential | null = null;
function cred(): DefaultAzureCredential {
  const clientId = getEnv().AZURE_CLIENT_ID;
  return (credential ??= new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : {}));
}

async function token(): Promise<string> {
  const t = await cred().getToken(`${ARM}/.default`);
  return t.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ARM request with a fixed host allow-list, timeout, and retry/backoff that honours Retry-After. */
async function arm(url: string, init: RequestInit & { json?: unknown } = {}, attempt = 0): Promise<Response> {
  if (!url.startsWith(`${ARM}/`)) throw new Error("Refusing to send an ARM token to a non-ARM address.");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await token()}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < 4) {
    const ra = Number(res.headers.get("retry-after"));
    const backoff = Math.min(30, Number.isFinite(ra) && ra > 0 ? ra : 2 ** attempt * 2) + Math.random();
    await sleep(backoff * 1000);
    return arm(url, init, attempt + 1);
  }
  return res;
}

async function argQuery<T>(subscriptions: string[], query: string): Promise<T[]> {
  const rows: T[] = [];
  let skipToken: string | undefined;
  for (let page = 0; page < 40; page++) {
    const res = await arm(`${ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`, {
      method: "POST",
      json: { subscriptions, query, options: { $top: 1000, resultFormat: "objectArray", ...(skipToken ? { $skipToken: skipToken } : {}) } },
    });
    if (!res.ok) throw new Error(`Resource Graph returned HTTP ${res.status}`);
    const j = (await res.json()) as { data?: T[]; $skipToken?: string };
    rows.push(...(j.data ?? []));
    skipToken = j.$skipToken;
    if (!skipToken) break;
  }
  return rows;
}

interface VmStatusRow {
  id: string;
  properties?: { instanceView?: { statuses?: { code: string; time?: string }[] } };
}

async function vmStatuses(subscriptionId: string): Promise<VmStatusRow[]> {
  const out: VmStatusRow[] = [];
  let url: string | undefined = `${ARM}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/virtualMachines?statusOnly=true&api-version=2024-07-01`;
  for (let page = 0; url && page < 100; page++) {
    const res = await arm(url);
    if (!res.ok) throw new Error(`VM status list returned HTTP ${res.status}`);
    const j = (await res.json()) as { value?: VmStatusRow[]; nextLink?: string };
    out.push(...(j.value ?? []));
    url = j.nextLink && j.nextLink.startsWith(`${ARM}/`) ? j.nextLink : undefined; // never follow a link off ARM
  }
  return out;
}

const q = (s: string) => s.toLowerCase();
const lastSeg = (id: string) => id.split("/").pop() ?? id;

async function load(): Promise<Fleet> {
  const subs = getEnv().subscriptionIds;
  const warnings: string[] = [];

  const [poolRows, hostRows, planRows, vmRows] = await Promise.all([
    argQuery<{ id: string; name: string; subscriptionId: string; hpt: string; svoc: string; max: number | null }>(
      subs,
      "desktopvirtualizationresources | where type =~ 'microsoft.desktopvirtualization/hostpools' | project id, name, subscriptionId, hpt=tostring(properties.hostPoolType), svoc=tostring(properties.startVMOnConnect), max=toint(properties.maxSessionLimit)",
    ),
    argQuery<{ id: string; name: string; status: string; sessions: number | null; allow: string; vmid: string; agent: string; hb: string }>(
      subs,
      "desktopvirtualizationresources | where type =~ 'microsoft.desktopvirtualization/hostpools/sessionhosts' | project id, name, status=tostring(properties.status), sessions=toint(properties.sessions), allow=tostring(properties.allowNewSession), vmid=tostring(properties.resourceId), agent=tostring(properties.agentVersion), hb=tostring(properties.lastHeartBeat)",
    ),
    argQuery<{ poolId: string }>(
      subs,
      "desktopvirtualizationresources | where type =~ 'microsoft.desktopvirtualization/scalingplans' | mv-expand ref = properties.hostPoolReferences | where tobool(ref.scalingPlanEnabled) == true | project poolId = tolower(tostring(ref.hostPoolArmPath))",
    ),
    argQuery<{ id: string; name: string; rg: string; size: string; hib: string; tags: Record<string, string> | null }>(
      subs,
      "resources | where type =~ 'microsoft.compute/virtualmachines' | project id=tolower(id), name, rg=tolower(resourceGroup), size=tostring(properties.hardwareProfile.vmSize), hib=tostring(properties.additionalCapabilities.hibernationEnabled), tags",
    ),
  ]);

  // Power state: statusOnly gives PowerState/*, HibernationState/* and ProvisioningState/* for every VM.
  const power = new Map<string, { power: string | null; hibernated: boolean; provisioning: string; time: string | null }>();
  for (const sub of subs) {
    try {
      for (const vm of await vmStatuses(sub)) {
        const st = vm.properties?.instanceView?.statuses ?? [];
        const pw = st.find((s) => s.code.startsWith("PowerState/"));
        const prov = st.find((s) => s.code.startsWith("ProvisioningState/"));
        power.set(q(vm.id), {
          power: pw ? pw.code.slice("PowerState/".length).toLowerCase() : "",
          hibernated: st.some((s) => s.code === "HibernationState/Hibernated"),
          provisioning: prov ? prov.code.slice("ProvisioningState/".length).split("/")[0]!.toLowerCase() : "succeeded",
          time: prov?.time ?? null,
        });
      }
    } catch (e) {
      // Do NOT treat a failed read as "blank power state": that would invent false alarms.
      warnings.push(`Could not read VM power states for one subscription (${(e as Error).message}). Affected hosts show "unreadable".`);
    }
  }

  const planned = new Set(planRows.map((r) => q(r.poolId)));
  const vmInfo = new Map(vmRows.map((v) => [v.id, v]));

  const pools: HostPool[] = poolRows.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.hpt === "Personal" ? "Personal" : "Pooled",
    subscriptionId: p.subscriptionId,
    hasScalingPlan: planned.has(q(p.id)),
    startVmOnConnect: String(p.svoc).toLowerCase() === "true",
    maxSessionLimit: p.max ?? null,
  }));
  const poolById = new Map(pools.map((p) => [q(p.id), p]));

  const hosts: SessionHost[] = hostRows.flatMap((h) => {
    const poolId = h.id.split(/\/sessionhosts\//i)[0]!;
    // Never drop a host just because its pool was not returned (for example no read access to the pool).
    const pool = poolById.get(q(poolId)) ?? { id: poolId, name: `${lastSeg(poolId)} (pool not readable)`, type: "Pooled" as const, subscriptionId: "", hasScalingPlan: false, startVmOnConnect: false, maxSessionLimit: null };
    const vmKey = q(h.vmid ?? "");
    const info = vmInfo.get(vmKey);
    const pw = power.get(vmKey);
    const readFailed = !pw && vmKey !== "";
    const host: SessionHost = {
      id: h.id,
      name: lastSeg(h.name).split(".")[0]!,
      poolId: pool.id,
      poolName: pool.name,
      vmResourceId: h.vmid || null,
      vmSize: info?.size ?? null,
      agentStatus: (h.status || "Unknown") as AgentStatus,
      agentVersion: h.agent || null,
      powerState: readFailed ? "unreadable" : (pw?.power ?? ""),
      hibernated: pw?.hibernated ?? false,
      hibernationEnabled: String(info?.hib).toLowerCase() === "true",
      provisioningState: pw?.provisioning ?? "succeeded",
      lastPowerChangeUtc: pw?.time ?? null,
      lastHeartBeatUtc: h.hb || null,
      sessions: h.sessions ?? 0,
      drained: String(h.allow).toLowerCase() === "false",
      excludedFromWatchdog: !!info?.tags && WATCHDOG_EXCLUDE_TAG in info.tags,
    };
    return [host];
  });

  // VMs that live in the same resource groups as the fleet but are not registered as session hosts.
  const registered = new Set(hostRows.map((h) => q(h.vmid ?? "")).filter(Boolean));
  const fleetRgs = new Set<string>();
  for (const h of hostRows) {
    const m = /\/resourcegroups\/([^/]+)\//i.exec(h.vmid ?? "");
    if (m) fleetRgs.add(m[1]!.toLowerCase());
  }
  for (const p of poolRows) {
    const m = /\/resourcegroups\/([^/]+)\//i.exec(p.id);
    if (m) fleetRgs.add(m[1]!.toLowerCase());
  }
  const unregistered: UnregisteredVm[] = vmRows
    .filter((v) => fleetRgs.has(v.rg) && !registered.has(v.id))
    .map((v) => ({ id: v.id, name: v.name, resourceGroup: v.rg, vmSize: v.size || null, powerState: power.get(v.id)?.power ?? "unreadable" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (hosts.some((h) => h.poolName.endsWith("(pool not readable)"))) {
    warnings.push("Some session hosts belong to a host pool this identity cannot read. They are listed under their pool id.");
  }
  return { generatedAtUtc: new Date().toISOString(), source: "azure", pools, hosts, unregistered, history: {}, warnings };
}

let cache: { at: number; fleet: Fleet } | null = null;
let inflight: Promise<Fleet> | null = null;

// ---- User sessions ----------------------------------------------------------------------------------
// One ARM call per host pool that currently has sessions (the host list already carries session counts, so
// empty pools cost nothing). Cached for a minute and fetched only when the Sessions page asks, to stay well
// inside ARM read throttling. https://learn.microsoft.com/rest/api/desktopvirtualization/user-sessions/list
interface UserSessionRow {
  id: string;
  properties?: { userPrincipalName?: string; activeDirectoryUserName?: string; sessionState?: string; createTime?: string; applicationType?: string };
}
const SESSION_CACHE_MS = 60_000;
let sessionCache: { at: number; value: { sessions: UserSession[]; warnings: string[] } } | null = null;
let sessionInflight: Promise<{ sessions: UserSession[]; warnings: string[] }> | null = null;

async function poolSessions(pool: HostPool): Promise<UserSession[]> {
  const out: UserSession[] = [];
  let url: string | undefined = `${ARM}${pool.id}/userSessions?api-version=2024-04-03`;
  for (let page = 0; url && page < 50; page++) {
    const res = await arm(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { value?: UserSessionRow[]; nextLink?: string };
    for (const r of j.value ?? []) {
      const raw = r.properties?.sessionState ?? "";
      const hostId = r.id.split(/\/usersessions\//i)[0] ?? "";
      out.push({
        id: r.id,
        user: r.properties?.userPrincipalName || r.properties?.activeDirectoryUserName || "unknown",
        hostName: lastSeg(hostId).split(".")[0]!,
        hostId,
        poolName: pool.name,
        state: raw.toLowerCase() === "active" ? "active" : raw.toLowerCase() === "disconnected" ? "disconnected" : "other",
        rawState: raw,
        startedUtc: r.properties?.createTime ?? null,
        application: r.properties?.applicationType ?? "",
      });
    }
    url = j.nextLink && j.nextLink.startsWith(`${ARM}/`) ? j.nextLink : undefined;
  }
  return out;
}

async function loadSessions(): Promise<{ sessions: UserSession[]; warnings: string[] }> {
  const fleet = await azureProvider.getFleet();
  const withSessions = new Set(fleet.hosts.filter((h) => h.sessions > 0).map((h) => q(h.poolId)));
  const targets = fleet.pools.filter((p) => withSessions.has(q(p.id)));
  const sessions: UserSession[] = [];
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const pool = targets[next++]!;
      try {
        sessions.push(...(await poolSessions(pool)));
      } catch (e) {
        failed.push(`${pool.name} (${(e as Error).message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, targets.length) }, worker)); // modest concurrency on purpose
  const warnings = failed.length ? [`Sessions could not be read for ${failed.length} host pool(s): ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ", and more" : ""}.`] : [];
  sessions.sort((a, b) => a.user.localeCompare(b.user));
  return { sessions, warnings };
}

export const azureProvider: FleetProvider = {
  source: "azure",

  async getSessions() {
    if (sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_MS) return sessionCache.value;
    sessionInflight ??= loadSessions().finally(() => {
      sessionInflight = null;
    });
    const value = await sessionInflight;
    sessionCache = { at: Date.now(), value };
    return value;
  },

  async getFleet(): Promise<Fleet> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.fleet;
    inflight ??= load().finally(() => {
      inflight = null;
    });
    const fleet = await inflight;
    cache = { at: Date.now(), fleet };
    return fleet;
  },

  async applyAction(hostId: string, action: HostAction): Promise<ActionResult> {
    if (getEnv().ENABLE_WEB_ACTIONS !== "true") {
      return { ok: false, message: "Actions are turned off for this deployment (ENABLE_WEB_ACTIONS)." };
    }
    // Resolve the target from OUR data. Never act on an id the browser merely supplied.
    cache = null;
    const fleet = await this.getFleet();
    const host = fleet.hosts.find((h) => h.id === hostId);
    if (!host) return { ok: false, message: "Host not found." };

    if (action === "drain" || action === "undrain") {
      const res = await arm(`${ARM}${host.id}?api-version=2024-04-03`, { method: "PATCH", json: { properties: { allowNewSession: action === "undrain" } } });
      return res.ok ? { ok: true, message: `${host.name} ${action === "drain" ? "drained" : "set to accept sessions"}.` } : { ok: false, message: `Azure returned HTTP ${res.status}.` };
    }

    if (!host.vmResourceId) return { ok: false, message: "This host has no VM resource id." };
    const verb = action === "deallocate" ? "deallocate" : action === "restart" ? "restart" : "start";
    const res = await arm(`${ARM}${host.vmResourceId}/${verb}?api-version=2024-07-01`, { method: "POST" });
    if (res.status === 200 || res.status === 202) {
      cache = null;
      return { ok: true, message: `${verb[0]!.toUpperCase()}${verb.slice(1)} requested for ${host.name}. It can take a few minutes.` };
    }
    return { ok: false, message: `Azure returned HTTP ${res.status}.` };
  },
};
