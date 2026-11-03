import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { classifyHost } from "@/lib/fleet/classify";
import { getProvider } from "@/lib/fleet";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

// The watchdog itself runs as a timer Function (functions/watchdog). This endpoint shows what it would act on
// right now, using the same rules, plus the deployment's configured mode. Past runs are read from Application
// Insights by the KQL in docs/watchdog-kql.md (a Log Analytics reader integration is a v1 item).
export async function GET() {
  const auth = await requireRole("Reader");
  if ("error" in auth) return auth.error;
  const env = getEnv();
  const fleet = await getProvider().getFleet();
  const now = new Date();
  const stuck = fleet.hosts
    .map((h) => ({ h, health: classifyHost(h, now) }))
    .filter((x) => x.health.state === "stuck")
    .map(({ h, health }) => ({
      id: h.id,
      name: h.name,
      pool: h.poolName,
      reason: health.reason,
      summary: health.summary,
      sessions: h.sessions,
      excluded: h.excludedFromWatchdog,
      wouldAct: !h.excludedFromWatchdog && h.sessions === 0,
      blockedBecause: h.excludedFromWatchdog ? "Tagged avd-watchdog-exclude" : h.sessions > 0 ? "Has user sessions" : null,
    }));
  return NextResponse.json({
    mode: env.WATCHDOG_MODE,
    schedule: "every 15 minutes",
    safeguards: [
      "Confirms the problem on 3 checks in a row before acting",
      "Never touches a host with user sessions",
      "Skips any VM tagged avd-watchdog-exclude",
      "Stops and reports if more than half a pool looks stuck",
      "Acts on at most 10 hosts per run",
    ],
    stuck,
  });
}
