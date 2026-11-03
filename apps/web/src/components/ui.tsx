"use client";

import { AlertTriangle, CheckCircle2, CircleOff, Loader2, Moon, PauseCircle, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { HealthState } from "@/lib/types";

export const STATE_META: Record<HealthState, { label: string; color: string; Icon: typeof CheckCircle2; pulse?: boolean }> = {
  healthy: { label: "Healthy", color: "var(--ok)", Icon: CheckCircle2 },
  draining: { label: "Draining", color: "var(--info)", Icon: PauseCircle },
  hibernated: { label: "Hibernated", color: "var(--violet)", Icon: Moon },
  off: { label: "Off", color: "var(--faint)", Icon: CircleOff },
  starting: { label: "Starting", color: "var(--info)", Icon: Loader2, pulse: true },
  stuck: { label: "Stuck", color: "var(--bad)", Icon: ShieldAlert, pulse: true },
  degraded: { label: "Degraded", color: "var(--warn)", Icon: AlertTriangle },
};

export function StateBadge({ state }: { state: HealthState }) {
  const m = STATE_META[state];
  return (
    <span className={`badge ${m.pulse ? "pulse" : ""}`} style={{ "--c": m.color } as CSSProperties}>
      <span className="dot" aria-hidden />
      {m.label}
    </span>
  );
}

export function relTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

/** Number that eases up to its value. Respects reduced motion. */
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown}</>;
}

export function Kpi({ label, value, hint, color, icon }: { label: string; value: number; hint?: string; color?: string; icon: ReactNode }) {
  return (
    <div className="card card-hover p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[var(--muted)]">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${color ?? "var(--accent)"} 16%, transparent)`, color: color ?? "var(--accent)" }}>{icon}</span>
      </div>
      <div className="mt-3 text-[34px] font-semibold leading-none tracking-tight tabular-nums">
        <CountUp value={value} />
      </div>
      {hint && <div className="mt-2 text-xs text-[var(--faint)]">{hint}</div>}
    </div>
  );
}

export function Donut({ parts, size = 168, center }: { parts: { value: number; color: string; label: string }[]; size?: number; center?: ReactNode }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={14} />
        {parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * c;
          const gap = parts.filter((x) => x.value > 0).length > 1 ? 3 : 0;
          const el = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={14} strokeLinecap="round"
              strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset}
              style={{ ["--len" as string]: `${len}`, animation: "draw .9s cubic-bezier(.2,.7,.2,1) both" }} />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{center}</div>
    </div>
  );
}

export function Sparkline({ data, color = "var(--accent)", height = 36, width = 120, label }: { data: number[]; color?: string; height?: number; width?: number; label?: string }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data, 90), max = 100;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 3 - ((v - min) / (max - min || 1)) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const id = `sp-${Math.abs(Math.round(data.reduce((a, b) => a + b, 0) * 100))}`;
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? "24 hour availability"}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} />
    </svg>
  );
}

export function StackBar({ parts }: { parts: { value: number; color: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--accent)]">{icon}</div>
      <div className="text-base font-semibold">{title}</div>
      <p className="max-w-sm text-sm text-[var(--muted)]">{body}</p>
    </div>
  );
}
