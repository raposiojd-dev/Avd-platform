import type { ActionResult, Fleet, HostAction, UserSession } from "../types";

export interface FleetProvider {
  readonly source: "demo" | "azure";
  getFleet(): Promise<Fleet>;
  getSessions(): Promise<{ sessions: UserSession[]; warnings: string[] }>;
  applyAction(hostId: string, action: HostAction): Promise<ActionResult>;
}
