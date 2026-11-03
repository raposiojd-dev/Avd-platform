import { NextResponse } from "next/server";
import { actionsEnabled } from "@/lib/actions";
import { hasRole } from "@/lib/auth";
import { classifyHost, summarize } from "@/lib/fleet/classify";
import { getProvider } from "@/lib/fleet";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("Reader");
  if ("error" in auth) return auth.error;
  try {
    const fleet = await getProvider().getFleet();
    const now = new Date();
    const hosts = fleet.hosts.map((h) => ({ ...h, health: classifyHost(h, now) }));
    return NextResponse.json({
      generatedAtUtc: fleet.generatedAtUtc,
      source: fleet.source,
      warnings: fleet.warnings,
      pools: fleet.pools,
      history: fleet.history,
      hosts,
      summary: summarize(fleet.hosts, now),
      me: { name: auth.principal.name, roles: auth.principal.roles, canAct: actionsEnabled() && hasRole(auth.principal, "Operator"), isAdmin: hasRole(auth.principal, "Admin") },
    });
  } catch (e) {
    console.error(JSON.stringify({ type: "error", route: "fleet", message: (e as Error).message }));
    return NextResponse.json({ error: "Could not load the fleet. Check the server log." }, { status: 502 });
  }
}
