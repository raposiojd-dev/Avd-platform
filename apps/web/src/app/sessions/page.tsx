"use client";

import { Download, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, Skeleton, relTime } from "@/components/ui";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { SessionsResponse } from "@/lib/api-types";

const STATES = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "disconnected", label: "Disconnected" },
] as const;

export default function SessionsPage() {
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState<string>("all");
  const [pool, setPool] = useState("");

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/sessions", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: SessionsResponse) => { if (live) { setData(j); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); });
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const pools = useMemo(() => Array.from(new Set((data?.sessions ?? []).map((s) => s.poolName))).sort(), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.sessions ?? [])
      .filter((x) => !pool || x.poolName === pool)
      .filter((x) => state === "all" || x.state === state)
      .filter((x) => !s || `${x.user} ${x.hostName}`.toLowerCase().includes(s));
  }, [data, q, state, pool]);

  const active = (data?.sessions ?? []).filter((s) => s.state === "active").length;
  const disc = (data?.sessions ?? []).filter((s) => s.state === "disconnected").length;

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sessions</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Every user session across all host pools, active and disconnected. Refreshes every minute.</p>
      </div>

      {failed && <div role="alert" className="rounded-xl border border-[var(--border)] p-3 text-sm" style={{ color: "var(--warn)" }}>Could not load sessions right now. Retrying.</div>}
      {data?.warnings.map((w) => <div key={w} className="rounded-xl border border-[var(--border)] p-3 text-sm text-[var(--muted)]">{w} The list below may be incomplete.</div>)}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input className="input !pl-9" placeholder="Filter by user or host" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter sessions" />
        </div>
        <select className="input !w-auto" value={pool} onChange={(e) => setPool(e.target.value)} aria-label="Filter by host pool">
          <option value="">All host pools</option>
          {pools.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {STATES.map((f) => (
          <button key={f.id} className="chip" aria-pressed={state === f.id} onClick={() => setState(f.id)}>
            {f.label} <span className="opacity-70">{f.id === "all" ? data?.sessions.length ?? 0 : f.id === "active" ? active : disc}</span>
          </button>
        ))}
        <button className="btn btn-sm ml-auto" disabled={rows.length === 0} onClick={() => downloadCsv("sessions.csv", toCsv(["User", "Host", "Pool", "State", "Started (UTC)", "Type"], rows.map((s) => [s.user, s.hostName, s.poolName, s.rawState || s.state, s.startedUtc, s.application])))}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {!data ? <Skeleton style={{ height: 300 }} /> : rows.length === 0 ? (
        <EmptyState icon={<Users size={26} />} title={data.sessions.length === 0 ? "No user sessions right now" : "No sessions match"} body={data.sessions.length === 0 ? "Nobody is signed in to any host pool." : "Try a different filter or clear the search."} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs text-[var(--faint)]"><tr><th className="px-5 py-3 font-medium">User</th><th className="px-3 py-3 font-medium">Host</th><th className="px-3 py-3 font-medium">Pool</th><th className="px-3 py-3 font-medium">State</th><th className="px-5 py-3 font-medium">Signed in</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3 font-medium">{s.user}</td>
                    <td className="px-3 py-3">{s.hostName}</td>
                    <td className="px-3 py-3 text-[var(--muted)]">{s.poolName}</td>
                    <td className="px-3 py-3"><span className="badge" style={{ "--c": s.state === "active" ? "var(--ok)" : s.state === "disconnected" ? "var(--warn)" : "var(--faint)" } as React.CSSProperties}><span className="dot" />{s.rawState || s.state}</span></td>
                    <td className="px-5 py-3 text-[var(--muted)]">{relTime(s.startedUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
