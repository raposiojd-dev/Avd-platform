import type { AuditEntry } from "./types";

// MVP store: in memory plus a structured log line, which App Insights / Log Analytics keep durably.
// A SQL-backed store replaces this before v1 (docs/adr). Entries are capped to bound memory.
const g = globalThis as unknown as { __audit?: AuditEntry[] };
const store = (g.__audit ??= []);
const MAX = 500;

export function writeAudit(e: Omit<AuditEntry, "id" | "atUtc">): AuditEntry {
  const entry: AuditEntry = { id: crypto.randomUUID(), atUtc: new Date().toISOString(), ...e };
  store.unshift(entry);
  if (store.length > MAX) store.length = MAX;
  // One JSON line: lands in Application Insights traces. Never include tokens or secrets here.
  console.log(JSON.stringify({ type: "audit", ...entry }));
  return entry;
}

export function listAudit(limit = 200): AuditEntry[] {
  return store.slice(0, limit);
}
