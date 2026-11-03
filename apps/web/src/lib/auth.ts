import { headers } from "next/headers";
import { getEnv } from "./env";
import type { Principal, Role } from "./types";

const ROLE_ORDER: Role[] = ["Reader", "Operator", "Admin"];

export function hasRole(p: Principal, min: Role): boolean {
  const best = Math.max(-1, ...p.roles.map((r) => ROLE_ORDER.indexOf(r)));
  return best >= ROLE_ORDER.indexOf(min);
}

interface ClientPrincipal {
  auth_typ?: string;
  name_typ?: string;
  role_typ?: string;
  claims?: { typ: string; val: string }[];
}

/**
 * Parses the identity App Service Authentication (Easy Auth) forwards after it has already validated the
 * Entra ID token. The header is only trustworthy because App Service strips any client-supplied copy and
 * the site is set to require authentication (infra/). Roles come from Entra app roles (the "roles" claim).
 * https://learn.microsoft.com/azure/app-service/configure-authentication-user-identities
 */
export function parseClientPrincipal(headerValue: string | null): Principal | null {
  if (!headerValue) return null;
  try {
    const json = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as ClientPrincipal;
    const claims = json.claims ?? [];
    const get = (...types: string[]) => claims.find((c) => types.includes(c.typ))?.val;
    const id = get("http://schemas.microsoft.com/identity/claims/objectidentifier", "oid") ?? "";
    const name = get("name", "preferred_username", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ?? "unknown";
    const roleTyp = json.role_typ ?? "roles";
    const raw = claims.filter((c) => c.typ === roleTyp || c.typ === "roles" || c.typ === "http://schemas.microsoft.com/ws/2008/06/identity/claims/role").map((c) => c.val);
    const roles = raw.filter((r): r is Role => (ROLE_ORDER as string[]).includes(r));
    if (!id) return null;
    return { id, name, roles };
  } catch {
    return null;
  }
}

export async function getPrincipal(): Promise<Principal | null> {
  if (getEnv().FLEET_PROVIDER === "demo") {
    return { id: "demo-user", name: "Demo Admin", roles: ["Admin"] };
  }
  const h = await headers();
  return parseClientPrincipal(h.get("x-ms-client-principal"));
}
