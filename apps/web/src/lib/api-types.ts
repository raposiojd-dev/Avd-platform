import type { HostHealth, HostPool, SessionHost } from "./types";

export type HostRow = SessionHost & { health: HostHealth };

export interface FleetResponse {
  generatedAtUtc: string;
  source: "demo" | "azure";
  warnings: string[];
  pools: HostPool[];
  history: Record<string, number[]>;
  hosts: HostRow[];
  summary: { total: number; healthy: number; draining: number; hibernated: number; off: number; starting: number; stuck: number; degraded: number };
  me: { name: string; roles: string[]; canAct: boolean; isAdmin: boolean };
}
