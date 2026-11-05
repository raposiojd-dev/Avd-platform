"use client";

import { ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, Skeleton, relTime } from "@/components/ui";
import type { AuditEntry } from "@/lib/types";

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    fetch("/api/audit", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { entries: [] })).then((j: { entries: AuditEntry[] }) => setEntries(j.entries)).catch(() => setEntries([]));
  }, []);
  const color = (o: AuditEntry["outcome"]) => (o === "success" ? "var(--ok)" : o === "denied" ? "var(--warn)" : "var(--bad)");

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Audit log</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Every action taken in the product, including refused ones.</p>
      </div>
      {!entries ? <Skeleton style={{ height: 260 }} /> : entries.length === 0 ? (
        <EmptyState icon={<ScrollText size={26} />} title="No actions yet" body="Actions you take on hosts will appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-[var(--faint)]"><tr><th className="px-5 py-3 font-medium">When</th><th className="px-3 py-3 font-medium">Who</th><th className="px-3 py-3 font-medium">Action</th><th className="px-3 py-3 font-medium">Target</th><th className="px-5 py-3 font-medium">Result</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-5 py-3 text-[var(--muted)]" title={e.atUtc}>{relTime(e.atUtc)}</td>
                  <td className="px-3 py-3">{e.actor}</td>
                  <td className="px-3 py-3">{e.action}</td>
                  <td className="px-3 py-3">{e.target}</td>
                  <td className="px-5 py-3"><span style={{ color: color(e.outcome) }}>{e.outcome}</span><div className="text-xs text-[var(--faint)]">{e.detail}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
