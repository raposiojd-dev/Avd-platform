"use client";

import { Activity, LayoutDashboard, Search, ScrollText, ServerCog, RefreshCw, Info, Users, Settings as Cog, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";
import { CommandPalette } from "./command-palette";
import { useFleet } from "./fleet-context";
import { ThemeToggle } from "./theme";

const NAV = [
  { href: "/", label: "Overview", Icon: LayoutDashboard },
  { href: "/hosts", label: "Hosts", Icon: ServerCog },
  { href: "/sessions", label: "Sessions", Icon: Users },
  { href: "/watchdog", label: "Watchdog", Icon: Activity },
  { href: "/audit", label: "Audit log", Icon: ScrollText },
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "var(--accent-grad)", boxShadow: "0 8px 22px -10px var(--accent)" }} aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M3 17l5-6 4 4 4-7 5 9" /></svg>
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight">{PRODUCT_NAME}</div>
        <div className="hidden text-[11px] text-[var(--faint)] xl:block">{PRODUCT_TAGLINE}</div>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data, error, refresh } = useFleet();
  const [palette, setPalette] = useState(false);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stuck = data?.summary.stuck ?? 0;
  const nav = data?.me.isAdmin ? [...NAV, { href: "/settings", label: "Settings", Icon: Cog }] : NAV;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-[var(--surface-solid)] focus:px-3 focus:py-2">Skip to content</a>

      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-[var(--border)] bg-[var(--surface)] p-5 backdrop-blur-xl lg:flex" aria-label="Primary">
        <Logo />
        <nav className="flex flex-col gap-1">
          {nav.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors"
                style={{ background: active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent", color: active ? "var(--text)" : "var(--muted)" }}>
                <Icon size={17} style={{ color: active ? "var(--accent)" : undefined }} />
                <span className="flex-1">{label}</span>
                {href === "/hosts" && stuck > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: "var(--bad)" }}>{stuck}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 text-xs text-[var(--muted)]">
          {data && (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <div className="font-medium text-[var(--text)]">{data.me.name}</div>
              <div>{data.me.roles.join(", ") || "No role"}</div>
              {data.source !== "demo" && (
                <form method="post" action="/auth/logout" className="mt-2"><button className="inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--text)]"><LogOut size={13} /> Sign out</button></form>
              )}
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 backdrop-blur-xl sm:px-8">
          <div className="lg:hidden"><Logo /></div>
          <button className="btn ml-auto hidden h-10 w-full max-w-sm justify-start gap-2 !text-[var(--faint)] sm:inline-flex lg:ml-0" onClick={() => setPalette(true)} aria-label="Open command palette">
            <Search size={15} /> <span className="flex-1 text-left">Search hosts or run a command</span> <span className="kbd">Ctrl K</span>
          </button>
          <div className="ml-auto flex items-center gap-2 sm:ml-auto">
            <button className="btn btn-ghost h-10 w-10 !px-0 sm:hidden" onClick={() => setPalette(true)} aria-label="Search"><Search size={18} /></button>
            <button className="btn btn-ghost h-10 w-10 !px-0" aria-label="Refresh now"
              onClick={async () => { setSpinning(true); await refresh(); setTimeout(() => setSpinning(false), 400); }}>
              <RefreshCw size={17} className={spinning ? "animate-spin" : ""} />
            </button>
            <ThemeToggle />
          </div>
        </header>

        {data?.source === "demo" && (
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)] sm:px-8" style={{ background: "color-mix(in srgb, var(--info) 10%, transparent)" }}>
            <Info size={14} className="shrink-0" style={{ color: "var(--info)" }} /> You are looking at sample data. Nothing here is connected to Azure.
          </div>
        )}
        {error && <div role="alert" className="border-b border-[var(--border)] px-4 py-2 text-xs sm:px-8" style={{ background: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" }}>{error}</div>}
        {data?.warnings.map((w) => <div key={w} className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)] sm:px-8" style={{ background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>{w}</div>)}

        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface-solid)] lg:hidden" aria-label="Primary mobile">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className="relative flex flex-col items-center gap-1 py-2.5 text-[11px]" style={{ color: active ? "var(--accent)" : "var(--muted)" }}>
              <Icon size={19} />{label}
              {href === "/hosts" && stuck > 0 && <span className="absolute right-[28%] top-1.5 h-2 w-2 rounded-full" style={{ background: "var(--bad)" }} />}
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
