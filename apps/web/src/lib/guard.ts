import { NextResponse } from "next/server";
import { getPrincipal, hasRole } from "./auth";
import type { Principal, Role } from "./types";

/** Resolves the signed-in user or a ready-made 401/403 response. */
export async function requireRole(min: Role): Promise<{ principal: Principal } | { error: NextResponse }> {
  const principal = await getPrincipal();
  if (!principal) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!hasRole(principal, min)) return { error: NextResponse.json({ error: "You do not have access to this." }, { status: 403 }) };
  return { principal };
}

/**
 * CSRF defence for state-changing calls. Easy Auth uses a session cookie, so a hostile page could make the
 * browser POST to us. We require (a) a same-origin Origin header and (b) a custom header a cross-site form
 * cannot set. Both must pass.
 */
export function assertSameOriginMutation(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = !!origin && !!host && new URL(origin).host === host;
  } catch {
    ok = false;
  }
  if (!ok || req.headers.get("x-requested-with") !== "avd-platform") {
    return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  }
  return null;
}
