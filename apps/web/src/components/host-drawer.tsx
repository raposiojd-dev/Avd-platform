"use client";

import { Loader2, X, Wrench, Pause, Play, RotateCw, Power } from "lucide-react";
import { useEffect, useState } from "react";
import type { HostRow } from "@/lib/api-types";
import { useFleet } from "./fleet-context";
import { StateBadge, relTime } from "./ui";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2.5 text-sm last:border-0">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

export function HostDrawer({ host, onClose }: { host: HostRow | null; onClose: () => void }) {
  const { act, fix, busy, data } = useFleet();
  const [confirm, setConfirm] = useState<null | { label: string; run: () => void }>(null);

  useEffect(() => {
    if (!host) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [host, onClose]);
  useEffect(() => setConfirm(null), [host?.id]);

  if (!host) return null;
  const canAct = data?.me.canAct ?? false;
  const working = busy.has(host.id);
  const hasSessions = host.sessions > 0;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`Host ${host.name}`}>
      <button className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} tabIndex={-1} style={{ animation: "fade .15s ease both" }} />
      <aside className="card absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto !rounded-none !bg-[var(--surface-solid)] p-6 sm:!rounded-l-3xl" style={{ animation: "rise .3s cubic-bezier(.2,.7,.2,1) both" }}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">{host.name}</h2>
            <p className="text-sm text-[var(--muted)]">{host.poolName}</p>
          </div>
          <button className="btn btn-ghost h-9 w-9 !px-0" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="mb-5 rounded-2xl border border-[var(--border)] p-4">
          <StateBadge state={host.health.state} />
          <p className="mt-3 text-sm">{host.health.summary}</p>
          {host.health.advice && <p className="mt-2 text-sm text-[var(--muted)]">{host.health.advice}</p>}
        </div>

        {canAct ? (
          <div className="mb-6 space-y-3">
            {host.health.state === "stuck" && (
              <button className="btn btn-primary w-full" disabled={working || hasSessions} onClick={() => fix(host.id)}>
                {working ? <><Loader2 size={16} className="animate-spin" /> Fixing, you can leave this page</> : <><Wrench size={16} /> Fix this host</>}
              </button>
            )}
            {host.health.state === "stuck" && hasSessions && <p className="text-xs text-[var(--muted)]">This host has user sessions, so it is not touched automatically. Drain it and wait for users to leave first.</p>}
            <div className="grid grid-cols-2 gap-2">
              {host.drained
                ? <button className="btn" disabled={working} onClick={() => act(host.id, "undrain")}><Play size={15} /> Allow new sessions</button>
                : <button className="btn" disabled={working} onClick={() => act(host.id, "drain")}><Pause size={15} /> Drain</button>}
              <button className="btn" disabled={working} onClick={() => setConfirm({ label: `Restart ${host.name}?`, run: () => void act(host.id, "restart", { force: hasSessions }) })}><RotateCw size={15} /> Restart</button>
              <button className="btn" disabled={working || host.powerState === "running"} onClick={() => act(host.id, "start")}><Power size={15} /> Start</button>
              <button className="btn btn-danger" disabled={working} onClick={() => setConfirm({ label: hasSessions ? `${host.sessions} user(s) are signed in. Turn off anyway?` : `Turn off ${host.name}?`, run: () => void act(host.id, "deallocate", { force: hasSessions }) })}>Turn off</button>
            </div>
            {confirm && (
              <div className="rounded-xl border border-[var(--border-strong)] p-3 text-sm" role="alertdialog">
                <p className="mb-3">{confirm.label}</p>
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-primary" onClick={() => { confirm.run(); setConfirm(null); }}>Yes, do it</button>
                  <button className="btn btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mb-6 rounded-xl border border-[var(--border)] p-3 text-sm text-[var(--muted)]">You have read-only access. Ask an administrator for the Operator role to act on hosts.</p>
        )}

        <dl>
          <Row k="Power state" v={host.powerState || <span style={{ color: "var(--bad)" }}>Blank</span>} />
          <Row k="Agent" v={host.agentStatus} />
          <Row k="Last heartbeat" v={relTime(host.lastHeartBeatUtc)} />
          <Row k="Last power change" v={relTime(host.lastPowerChangeUtc)} />
          <Row k="User sessions" v={host.sessions} />
          <Row k="New sessions" v={host.drained ? "Blocked (draining)" : "Allowed"} />
          <Row k="Hibernation" v={host.hibernationEnabled ? "Enabled" : "Off"} />
          <Row k="VM size" v={host.vmSize ?? "Unknown"} />
          <Row k="Watchdog" v={host.excludedFromWatchdog ? "Excluded by tag" : "Included"} />
        </dl>
      </aside>
    </div>
  );
}
