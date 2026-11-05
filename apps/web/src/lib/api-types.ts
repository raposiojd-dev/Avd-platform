import type { HostHealth, HostPool, SessionHost, UnregisteredVm, UserSession } from "./types";

export interface SessionsResponse {
  generatedAtUtc: string;
  sessions: UserSession[];
  warnings: string[];
  /** Pools with sessions that could not be read. */
  incomplete: boolean;
}

export type HostRow = SessionHost & { health: HostHealth };

export interface FleetResponse {
  generatedAtUtc: string;
  source: "demo" | "azure";
  warnings: string[];
  pools: HostPool[];
  history: Record<string, number[]>;
  hosts: HostRow[];
  unregistered: UnregisteredVm[];
  summary: { total: number; healthy: number; draining: number; hibernated: number; off: number; starting: number; stuck: number; degraded: number };
  me: { name: string; roles: string[]; canAct: boolean; isAdmin: boolean };
}
