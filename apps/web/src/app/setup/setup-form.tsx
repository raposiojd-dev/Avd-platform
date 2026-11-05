"use client";

import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PRODUCT_NAME } from "@/lib/product";

export function SetupForm() {
  const [redirectUri, setRedirectUri] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ setupCode: "", tenantId: "", clientId: "", clientSecret: "", bootstrapAdminUpn: "" });

  useEffect(() => {
    fetch("/api/setup", { cache: "no-store" }).then((r) => r.json()).then((j: { redirectUri?: string }) => setRedirectUri(j.redirectUri ?? "")).catch(() => {});
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "avd-platform" }, body: JSON.stringify(f) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { setDone(true); setTimeout(() => { window.location.href = "/auth/login"; }, 1200); }
      else setError(j.error ?? "That did not work.");
    } catch { setError("Could not reach the server."); }
    finally { setBusy(false); }
  }

  const field = (k: keyof typeof f, label: string, hint?: string, type = "text", auto = "off") => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input className="input" type={type} value={f[k]} onChange={set(k)} required autoComplete={auto} spellCheck={false} />
      {hint && <span className="mt-1 block text-xs text-[var(--faint)]">{hint}</span>}
    </label>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <div className="card rise w-full p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: "var(--accent-grad)" }}><KeyRound size={19} color="#fff" /></div>
          <div><h1 className="text-xl font-semibold tracking-tight">Set up {PRODUCT_NAME}</h1><p className="text-sm text-[var(--muted)]">Connect your Microsoft Entra app registration. It is stored in your Key Vault, not in your code or repo.</p></div>
        </div>

        {done ? (
          <p className="flex items-center gap-2 py-6 text-sm"><Check size={18} style={{ color: "var(--ok)" }} /> Saved. Taking you to sign in.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] p-4 text-sm">
              <p className="mb-2 font-medium">In your app registration, add this redirect URI</p>
              <p className="mb-3 text-xs text-[var(--muted)]">Authentication, Add a platform, Web. Then under Certificates and secrets create a client secret and copy its value.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs">{redirectUri || "…"}</code>
                <button type="button" className="btn btn-sm" disabled={!redirectUri} onClick={() => { void navigator.clipboard.writeText(redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>

            {field("setupCode", "Setup code", "Printed once in this app's log stream (App Service, Monitoring, Log stream). It proves you own the deployment.", "password")}
            {field("tenantId", "Directory (tenant) ID")}
            {field("clientId", "Application (client) ID")}
            {field("clientSecret", "Client secret value", "The secret's Value, not its ID. Stored in your Key Vault.", "password", "new-password")}
            {field("bootstrapAdminUpn", "Your sign-in email", "You become the first Admin, so you cannot lock yourself out.", "email", "email")}

            {error && <p role="alert" className="rounded-xl border p-3 text-sm" style={{ borderColor: "color-mix(in srgb, var(--bad) 50%, transparent)", color: "var(--bad)" }}>{error}</p>}
            <button className="btn btn-primary w-full" disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" /> Checking with Microsoft</> : "Save and sign in"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
