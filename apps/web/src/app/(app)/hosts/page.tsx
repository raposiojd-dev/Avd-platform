"use client";

import { Download, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useFleet } from "@/components/fleet-context";
import { HostDrawer } from "@/components/host-drawer";
import { EmptyState, Skeleton, StateBadge, relTime } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "healthy", label: "Healthy" },
  { id: "asleep", label: "Hibernated / off" },
] as const;

function HostsInner() {
  const { data, loading } = useFleet();
  const sp = useSearchParams();
  const [filter, setFilter] = useState<string>(sp.get("filter") ?? "all");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pool, setPool] = useState<string>(sp.get("pool") ?? "");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.hosts ?? [])
      .filter((h) => !pool || h.poolName === pool)
      .filter((h) => !s || `${h.name} ${h.poolName}`.toLowerCase().includes(s))
      .filter((h) => {
        const st = h.health.state;
        if (filter === "attention") return st === "stuck" || st === "degraded";
        if (filter === "healthy") return st === "healthy";
        if (filter === "asleep") return st === "hibernated" || st === "off";
        return true;
      })
      .sort((a, b) => {
        const w = (x: string) => (x === "stuck" ? 0 : x === "degraded" ? 1 : 2);
        return w(a.health.state) - w(b.health.state) || a.name.localeCompare(b.name);
      });
  }, [data, filter, q, pool]);

  const open = data?.hosts.find((h) => h.id === openId) ?? null;
  const poolNames = useMemo(() => Array.from(new Set((data?.hosts ?? []).map((h) => h.poolName))).sort(), [data]);
  const counts = useMemo(() => {
    const all = data?.hosts ?? [];
    const base = pool ? all.filter((h) => h.poolName === pool) : all;
    return { all: base.length, attention: base.filter((h) => h.health.state === "stuck" || h.health.state === "degraded").length, healthy: base.filter((h) => h.health.state === "healthy").length, asleep: base.filter((h) => h.health.state === "hibernated" || h.health.state === "off").length };
  }, [data, pool]);
  const unregistered = (data?.unregistered ?? []).filter((v) => !q.trim() || v.name.toLowerCase().includes(q.trim().toLowerCase()));

  const exportCsv = () =>
    downloadCsv("session-hosts.csv", toCsv(
      ["Host", "Pool", "Status", "Power state", "Agent", "Sessions", "Draining", "Hibernation enabled", "VM size", "Last heartbeat (UTC)"],
      rows.map((h) => [h.name, h.poolName, h.health.state, h.powerState || "blank", h.agentStatus, h.sessions, h.drained ? "yes" : "no", h.hibernationEnabled ? "yes" : "no", h.vmSize, h.lastHeartBeatUtc]),
    ));

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hosts</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Every session host in the environment, including powered-off and hibernated ones. Select a host to see details and act on it.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input className="input !pl-9" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter hosts by name" />
        </div>
        <select className="input !w-auto" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Filter by host pool">
          <option value="">All host pools ({data?.pools.length ?? 0})</option>
          {poolNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {FILTERS.map((f) => <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <span className="opacity-70">{counts[f.id === "all" ? "all" : f.id as "attention" | "healthy" | "asleep"]}</span></button>)}
        <button className="btn btn-sm ml-auto" onClick={exportCsv} disabled={rows.length === 0}><Download size={14} /> Export CSV</button>
      </div>
      <p className="text-xs text-[var(--faint)]" aria-live="polite">Showing {rows.length} of {data?.hosts.length ?? 0} hosts</p>

      {loading || !data ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} style={{ height: 56 }} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title="No hosts match" body="Try a different filter or clear the search." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs text-[var(--faint)]">
                <tr><th className="px-5 py-3 font-medium">Host</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Power</th><th className="px-3 py-3 font-medium">Agent</th><th className="px-3 py-3 font-medium">Sessions</th><th className="px-5 py-3 font-medium">Last heartbeat</th></tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.id} className="table-row border-b border-[var(--border)] last:border-0" tabIndex={0} onClick={() => setOpenId(h.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(h.id); } }}>
                    <td className="px-5 py-3.5"><div className="font-medium">{h.name}</div><div className="text-xs text-[var(--faint)]">{h.poolName}</div></td>
                    <td className="px-3 py-3.5"><StateBadge state={h.health.state} /></td>
                    <td className="px-3 py-3.5">{h.powerState || <span style={{ color: "var(--bad)" }}>Blank</span>}</td>
                    <td className="px-3 py-3.5 text-[var(--muted)]">{h.agentStatus}</td>
                    <td className="px-3 py-3.5">{h.sessions}</td>
                    <td className="px-5 py-3.5 text-[var(--muted)]">{relTime(h.lastHeartBeatUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {unregistered.length > 0 && (
        <section className="card rise p-6" aria-label="VMs that are not session hosts">
          <h2 className="font-semibold">Not registered as session hosts ({unregistered.length})</h2>
          <p className="mb-4 mt-1 text-sm text-[var(--muted)]">Virtual machines in the same resource groups as your host pools that are not registered with any pool. These could be old hosts that were removed from a pool, builds in progress, or other servers.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs text-[var(--faint)]"><tr><th className="py-2 pr-3 font-medium">VM</th><th className="px-3 py-2 font-medium">Resource group</th><th className="px-3 py-2 font-medium">Power</th><th className="px-3 py-2 font-medium">Size</th></tr></thead>
              <tbody>{unregistered.map((v) => <tr key={v.id} className="border-b border-[var(--border)] last:border-0"><td className="py-2.5 pr-3 font-medium">{v.name}</td><td className="px-3 py-2.5 text-[var(--muted)]">{v.resourceGroup}</td><td className="px-3 py-2.5">{v.powerState || "blank"}</td><td className="px-3 py-2.5 text-[var(--muted)]">{v.vmSize ?? "Unknown"}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      <HostDrawer host={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

export default function HostsPage() {
  return <Suspense fallback={<Skeleton style={{ height: 300 }} />}><HostsInner /></Suspense>;
}
