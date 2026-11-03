import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness for App Service health checks. No data, no auth, nothing sensitive.
export function GET() {
  return NextResponse.json({ ok: true });
}
