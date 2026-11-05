"use client";

import { Check, Loader2, LogOut } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useFleet } from "@/components/fleet-context";
import { Skeleton } from "@/components/ui";

interface View { tenantId: string; clientId: string; secretSet: boolean; bootstrapAdminUpn: string; redirectUri: string }

export default function SettingsPage() {
  const { toast, data } = useFleet();
  const [v, setV] = useState<View | null>(null);
  const [denied, setDenied] = useState(false);
  const [f, setF] = useState({ tenantId: "", clientId: "", clientSecret: "", bootstrapAdminUpn: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then(async (r) => {
      if (r.status === 403) { setDenied(true); return; }
      if (!r.ok) return;
      const j = (await r.json()) as View;
      setV(j); setF({ tenantId: j.tenantId, clientId: j.clientId, clientSecret: "", bootstrapAdminUpn: j.bootstrapAdminUpn });
    }).catch(() => {});
  }, []);

  async function save(e: FormEvent, rotateSessions = false) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", "X-Requested-With": "avd-platform" }, body: JSON.stringify({ ...f, rotateSessions }) });
      const j = (await res.json().catch(() => ({}))) as View & { error?: string; signedOutEveryone?: boolean };
      if (!res.ok) { setError(j.error ?? "That did not work."); return; }
      setV(j); setF((p) => ({ ...p, clientSecret: "" }));
      toast("ok", j.signedOutEveryone ? "Everyone has been signed out. You will be asked to sign in again." : "Settings saved.");
      if (j.signedOutEveryone) setTimeout(() => { window.location.href = "/auth/login"; }, 1500);
    } catch { setError("Could not reach the server."); }
    finally { setBusy(false); }
  }

  if (denied || (data && !data.me.isAdmin)) return <p className="card p-6 text-sm text-[var(--muted)]">Only an Admin can change settings.</p>;
  if (!v) return <Skeleton style={{ height: 360 }} />;

  const input = (k: keyof typeof f, label: string, hint?: string, type = "text") => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input className="input" type={type} value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} placeholder={k === "clientSecret" ? (v.secretSet ? "Leave blank to keep the saved secret" : "") : undefined} autoComplete="off" spellCheck={false} />
      {hint && <span className="mt-1 block text-xs text-[var(--faint)]">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="rise"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1><p className="mt-1 text-sm text-[var(--muted)]">Your Microsoft Entra app registration. Stored in your Key Vault, never in a file.</p></div>
      <form onSubmit={(e) => save(e)} className="card rise max-w-xl space-y-4 p-6">
        <div className="rounded-xl border border-[var(--border)] p-3 text-xs"><span className="text-[var(--muted)]">Redirect URI for the app registration: </span><code>{v.redirectUri}</code></div>
        {input("tenantId", "Directory (tenant) ID")}
        {input("clientId", "Application (client) ID")}
        {input("clientSecret", "Client secret value", "Only fill this in to replace the saved secret.", "password")}
        {input("bootstrapAdminUpn", "Always-Admin email", "This person is always an Admin, even without an Entra app role.")}
        {error && <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save changes</button>
          <button type="button" className="btn" disabled={busy} onClick={(e) => save(e as unknown as FormEvent, true)}><LogOut size={15} /> Save and sign everyone out</button>
        </div>
      </form>
    </div>
  );
}
