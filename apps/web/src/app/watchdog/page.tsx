"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useFleet } from "@/components/fleet-context";
import { Skeleton } from "@/components/ui";

interface WatchdogInfo {
  mode: string; schedule: string; safeguards: string[];
  stuck: { id: string; name: string; pool: string; summary: string; sessions: number; wouldAct: boolean; blockedBecause: string | null }[];
}

export default function WatchdogPage() {
  const { data } = useFleet();
  const [info, setInfo] = useState<WatchdogInfo | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/watchdog", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setInfo(j as WatchdogInfo); }).catch(() => {});
    void load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [data?.generatedAtUtc]);

  if (!info) return <Skeleton style={{ height: 320 }} />;
  const remediate = info.mode.toLowerCase() === "remediate";

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hibernate watchdog</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Finds hosts that wake from hibernate with a blank power state or an agent that never reconnects, turns them off cleanly and starts them again. Runs {info.schedule}.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card rise p-6">
          <div className="mb-4 flex items-center gap-3">
            <ShieldCheck style={{ color: "var(--accent)" }} />
            <div className="flex-1"><div className="font-semibold">Mode</div></div>
            <span className="badge" style={{ "--c": remediate ? "var(--ok)" : "var(--info)" } as React.CSSProperties}><span className="dot" />{remediate ? "Fixes automatically" : "Report only"}</span>
          </div>
          {!remediate && <p className="mb-4 rounded-xl border border-[var(--border)] p-3 text-sm text-[var(--muted)]">Report only is the safe default. It lists what it would do and changes nothing. An administrator switches it to automatic fixing in the deployment settings.</p>}
          <h3 className="mb-2 text-sm font-semibold text-[var(--muted)]">Built-in safeguards</h3>
          <ul className="space-y-2 text-sm">{info.safeguards.map((s) => <li key={s} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} />{s}</li>)}</ul>
        </section>

        <section className="card rise p-6">
          <h2 className="mb-4 font-semibold">Stuck right now</h2>
          {info.stuck.length === 0 ? <p className="text-sm text-[var(--muted)]">No stuck hosts. Nothing for the watchdog to do.</p> : (
            <ul className="divide-y divide-[var(--border)]">
              {info.stuck.map((h) => (
                <li key={h.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="font-medium">{h.name}</span><span className="text-xs text-[var(--faint)]">{h.pool}</span></div>
                  <p className="mt-1 text-[var(--muted)]">{h.summary}</p>
                  <p className="mt-1 text-xs" style={{ color: h.wouldAct ? "var(--ok)" : "var(--warn)" }}>{h.wouldAct ? (remediate ? "Will be fixed on the next run." : "Would be fixed in automatic mode.") : `Skipped: ${h.blockedBecause}`}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
