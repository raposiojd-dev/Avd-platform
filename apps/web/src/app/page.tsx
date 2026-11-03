"use client";

import { AlertTriangle, CheckCircle2, Moon, ServerCog, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useFleet } from "@/components/fleet-context";
import { Donut, EmptyState, Kpi, Skeleton, Sparkline, StackBar, STATE_META } from "@/components/ui";

export default function Overview() {
  const { data, loading } = useFleet();
  if (loading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton style={{ height: 40, width: 280 }} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 118 }} />)}</div>
        <Skeleton style={{ height: 300 }} />
      </div>
    );
  }
  const s = data.summary;
  if (s.total === 0) return <EmptyState icon={<ServerCog size={28} />} title="No session hosts found" body="Nothing was returned for the subscriptions this instance can read. Check the role assignment for the managed identity." />;

  const parts = (["healthy", "draining", "hibernated", "off", "starting", "degraded", "stuck"] as const)
    .map((k) => ({ value: s[k], color: STATE_META[k].color, label: STATE_META[k].label }))
    .filter((p) => p.value > 0);
  const attention = s.stuck + s.degraded;

  return (
    <div className="space-y-8">
      <div className="rise">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{attention === 0 ? <>Everything is <span className="gradient-text">running smoothly</span></> : <><span className="gradient-text">{attention} host{attention === 1 ? "" : "s"}</span> need attention</>}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{s.total} session hosts across {data.pools.length} host pool{data.pools.length === 1 ? "" : "s"}. Updates every 20 seconds.</p>
      </div>

      {s.stuck > 0 && (
        <Link href="/hosts?filter=attention" className="card card-hover rise flex items-center gap-4 p-5" style={{ borderColor: "color-mix(in srgb, var(--bad) 50%, transparent)" }}>
          <ShieldAlert size={26} style={{ color: "var(--bad)" }} />
          <div className="flex-1">
            <div className="font-semibold">{s.stuck} host{s.stuck === 1 ? " is" : "s are"} stuck after waking from hibernate</div>
            <div className="text-sm text-[var(--muted)]">Power state is blank or the agent never came back. Open them to fix with one click.</div>
          </div>
          <span className="btn btn-primary btn-sm">Review</span>
        </Link>
      )}

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Healthy" value={s.healthy} color="var(--ok)" icon={<CheckCircle2 size={18} />} hint="Ready for users" />
        <Kpi label="Hibernated or off" value={s.hibernated + s.off} color="var(--violet)" icon={<Moon size={18} />} hint="Saving cost" />
        <Kpi label="Degraded" value={s.degraded} color="var(--warn)" icon={<AlertTriangle size={18} />} hint="Agent reports a problem" />
        <Kpi label="Stuck" value={s.stuck} color="var(--bad)" icon={<ShieldAlert size={18} />} hint="Needs a restart" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="card rise flex flex-col items-center gap-5 p-6" aria-label="Fleet breakdown">
          <h2 className="self-start text-sm font-semibold text-[var(--muted)]">Fleet breakdown</h2>
          <Donut parts={parts} center={<div className="text-center"><div className="text-3xl font-semibold">{s.total}</div><div className="text-xs text-[var(--muted)]">hosts</div></div>} />
          <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {parts.map((p) => <li key={p.label} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.label}<span className="ml-auto text-[var(--muted)]">{p.value}</span></li>)}
          </ul>
        </section>

        <section className="card rise p-6" aria-label="Host pools">
          <h2 className="mb-4 text-sm font-semibold text-[var(--muted)]">Host pools</h2>
          <ul className="divide-y divide-[var(--border)]">
            {data.pools.map((p) => {
              const hs = data.hosts.filter((h) => h.poolId === p.id);
              const bad = hs.filter((h) => h.health.state === "stuck" || h.health.state === "degraded").length;
              const hist = data.history[p.id] ?? [];
              return (
                <li key={p.id}>
                  <Link href={`/hosts?pool=${encodeURIComponent(p.name)}`} className="grid items-center gap-4 py-4 sm:grid-cols-[1fr_140px_130px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="truncate font-medium">{p.name}</span><span className="chip !h-6 !text-[11px]">{p.type}</span></div>
                      <div className="mt-2"><StackBar parts={(["healthy", "draining", "hibernated", "off", "starting", "degraded", "stuck"] as const).map((k) => ({ value: hs.filter((h) => h.health.state === k).length, color: STATE_META[k].color, label: STATE_META[k].label }))} /></div>
                    </div>
                    <div className="hidden sm:block">{hist.length > 1 && <Sparkline data={hist} label={`${p.name} availability, last ${hist.length} hours`} />}</div>
                    <div className="text-sm sm:text-right" style={{ color: bad ? "var(--bad)" : "var(--muted)" }}>{bad ? `${bad} need attention` : `${hs.length} hosts · OK`}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
