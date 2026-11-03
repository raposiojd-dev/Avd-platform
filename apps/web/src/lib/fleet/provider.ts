import type { ActionResult, Fleet, HostAction } from "../types";

export interface FleetProvider {
  readonly source: "demo" | "azure";
  getFleet(): Promise<Fleet>;
  applyAction(hostId: string, action: HostAction): Promise<ActionResult>;
}
