"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FleetResponse } from "@/lib/api-types";
import type { HostAction } from "@/lib/types";

interface Toast { id: number; kind: "ok" | "error"; text: string }

interface Ctx {
  data: FleetResponse | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  act: (hostId: string, action: HostAction, opts?: { force?: boolean }) => Promise<boolean>;
  /** Deallocate, wait until Azure confirms it is off, then start for a clean boot. Safe to leave the page. */
  fix: (hostId: string) => Promise<void>;
  busy: ReadonlySet<string>;
  toast: (kind: Toast["kind"], text: string) => void;
}

const FleetCtx = createContext<Ctx | null>(null);
export const useFleet = () => {
  const c = useContext(FleetCtx);
  if (!c) throw new Error("useFleet outside provider");
  return c;
};

const POLL_MS = 20_000;

export function FleetProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const nextId = useRef(1);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet", { cache: "no-store" });
      if (res.status === 401) { setError("Your session has ended. Reload the page to sign in again."); return; }
      if (res.status === 403) { setError("You are signed in but have no role yet. Ask an administrator to assign you Reader, Operator or Admin."); setLoading(false); return; }
      if (!res.ok) { setError("Could not load the fleet right now. Retrying."); return; }
      setData((await res.json()) as FleetResponse);
      setError(null);
    } catch {
      setError("Could not reach the server. Retrying.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const act = useCallback<Ctx["act"]>(async (hostId, action, opts) => {
    try {
      const res = await fetch("/api/hosts/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "avd-platform" },
        body: JSON.stringify({ hostId, action, force: opts?.force ?? false }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      toast(res.ok && j.ok ? "ok" : "error", j.message ?? (res.ok ? "Done." : "That did not work."));
      await refresh();
      return !!(res.ok && j.ok);
    } catch {
      toast("error", "Could not reach the server.");
      return false;
    }
  }, [refresh, toast]);

  const fix = useCallback(async (hostId: string) => {
    setBusy((b) => new Set(b).add(hostId));
    try {
      const off = await act(hostId, "deallocate");
      if (!off) return;
      // Deallocation is asynchronous in Azure. Wait (up to 4 minutes) until the VM reports it is off.
      let confirmed = false;
      for (let i = 0; i < 48 && !confirmed; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await fetch("/api/fleet", { cache: "no-store" }).catch(() => null);
        if (!res?.ok) continue;
        const f = (await res.json()) as FleetResponse;
        setData(f);
        const h = f.hosts.find((x) => x.id === hostId);
        confirmed = !!h && ["deallocated"].includes(h.powerState);
      }
      if (!confirmed) { toast("error", "The VM did not report as off within 4 minutes. Check it in the Azure portal, then start it."); return; }
      await act(hostId, "start");
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(hostId); return n; });
    }
  }, [act, toast]);

  const value = useMemo(() => ({ data, error, loading, refresh, act, fix, busy, toast }), [data, error, loading, refresh, act, fix, busy, toast]);

  return (
    <FleetCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card rise pointer-events-auto flex items-start gap-3 px-4 py-3 text-sm" style={{ borderColor: t.kind === "ok" ? "color-mix(in srgb, var(--ok) 45%, transparent)" : "color-mix(in srgb, var(--bad) 45%, transparent)" }}>
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: t.kind === "ok" ? "var(--ok)" : "var(--bad)" }} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </FleetCtx.Provider>
  );
}
