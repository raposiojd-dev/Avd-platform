import { writeAudit } from "./audit";
import { hasRole } from "./auth";
import { getEnv } from "./env";
import { getProvider } from "./fleet";
import type { ActionResult, HostAction, Principal } from "./types";

const ACTIONS: HostAction[] = ["drain", "undrain", "restart", "deallocate", "start"];
export const isHostAction = (v: unknown): v is HostAction => typeof v === "string" && (ACTIONS as string[]).includes(v);

/**
 * The only way the app changes anything. Rules, in order:
 *  1. Operator role or above (checked here, server-side, regardless of what the UI shows).
 *  2. Never restart or deallocate a host that has user sessions. Admins may override with `force`.
 *  3. Every attempt, allowed or not, is audited.
 */
export async function performHostAction(p: Principal, hostId: string, action: HostAction, force = false): Promise<ActionResult> {
  const provider = getProvider();
  const fleet = await provider.getFleet();
  const host = fleet.hosts.find((h) => h.id === hostId);
  const target = host ? `${host.poolName}/${host.name}` : hostId;

  const deny = (detail: string): ActionResult => {
    writeAudit({ actor: p.name, action, target, outcome: "denied", detail });
    return { ok: false, message: detail };
  };

  if (!hasRole(p, "Operator")) return deny("You need the Operator role to do this.");
  if (!host) return deny("Host not found.");
  if (force && !hasRole(p, "Admin")) return deny("Only an Admin can override the active-session safety check.");

  if ((action === "restart" || action === "deallocate") && host.sessions > 0 && !force) {
    return deny(`${host.name} has ${host.sessions} user session(s). Drain it and wait for users to sign out, or an Admin can force it.`);
  }

  try {
    const result = await provider.applyAction(hostId, action);
    writeAudit({ actor: p.name, action: force ? `${action} (forced)` : action, target, outcome: result.ok ? "success" : "error", detail: result.message });
    return result;
  } catch (e) {
    const msg = "The action could not be completed. See the server log for details.";
    writeAudit({ actor: p.name, action, target, outcome: "error", detail: (e as Error).message.slice(0, 300) });
    return { ok: false, message: msg };
  }
}

export const actionsEnabled = () => getEnv().FLEET_PROVIDER === "demo" || getEnv().ENABLE_WEB_ACTIONS === "true";
