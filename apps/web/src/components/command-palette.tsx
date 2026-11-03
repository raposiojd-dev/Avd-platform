"use client";

import { Activity, LayoutDashboard, Moon, RefreshCw, Search, ServerCog, ScrollText, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFleet } from "./fleet-context";
import { useTheme } from "./theme";

interface Cmd { id: string; label: string; hint?: string; icon: ReactNode; run: () => void }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data, refresh } = useFleet();
  const { toggle } = useTheme();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 20); }
  }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => { router.push(href); onClose(); };
    const base: Cmd[] = [
      { id: "ov", label: "Go to Overview", icon: <LayoutDashboard size={16} />, run: go("/") },
      { id: "hosts", label: "Go to Hosts", icon: <ServerCog size={16} />, run: go("/hosts") },
      { id: "stuck", label: "Show stuck hosts", hint: "Hosts", icon: <ShieldAlert size={16} />, run: go("/hosts?filter=attention") },
      { id: "wd", label: "Go to Watchdog", icon: <Activity size={16} />, run: go("/watchdog") },
      { id: "au", label: "Go to Audit log", icon: <ScrollText size={16} />, run: go("/audit") },
      { id: "rf", label: "Refresh now", icon: <RefreshCw size={16} />, run: () => { void refresh(); onClose(); } },
      { id: "th", label: "Toggle light / dark theme", icon: <Moon size={16} />, run: () => { toggle(); onClose(); } },
    ];
    const hostCmds: Cmd[] = (data?.hosts ?? []).map((h) => ({
      id: `h-${h.id}`, label: h.name, hint: h.poolName, icon: <ServerCog size={16} />, run: go(`/hosts?q=${encodeURIComponent(h.name)}`),
    }));
    return [...base, ...hostCmds];
  }, [router, onClose, refresh, toggle, data]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? cmds.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(s)) : cmds.slice(0, 7);
    return list.slice(0, 9);
  }, [cmds, q]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-start justify-items-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command palette" style={{ animation: "fade .15s ease both" }}>
      <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="card rise relative w-full max-w-xl overflow-hidden !bg-[var(--surface-solid)]">
        <div className="relative border-b border-[var(--border)]">
          <Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or a host name"
            className="h-14 w-full bg-transparent pl-11 pr-4 text-[15px] outline-none placeholder:text-[var(--faint)]"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") shown[idx]?.run();
            }}
          />
        </div>
        <ul className="max-h-[50vh] overflow-auto p-2" role="listbox">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-[var(--muted)]">Nothing matches &ldquo;{q}&rdquo;.</li>}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === idx}>
              <button onMouseEnter={() => setIdx(i)} onClick={c.run}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm"
                style={{ background: i === idx ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent" }}>
                <span className="text-[var(--accent)]">{c.icon}</span>
                <span className="flex-1">{c.label}</span>
                {c.hint && <span className="text-xs text-[var(--faint)]">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--faint)]">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span><span><span className="kbd">Enter</span> open</span><span><span className="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
