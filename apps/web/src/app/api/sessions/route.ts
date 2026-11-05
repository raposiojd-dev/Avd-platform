import { NextResponse } from "next/server";
import type { SessionsResponse } from "@/lib/api-types";
import { getProvider } from "@/lib/fleet";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("Reader");
  if ("error" in auth) return auth.error;
  try {
    const { sessions, warnings } = await getProvider().getSessions();
    const body: SessionsResponse = { generatedAtUtc: new Date().toISOString(), sessions, warnings, incomplete: warnings.length > 0 };
    return NextResponse.json(body);
  } catch (e) {
    console.error(JSON.stringify({ type: "error", route: "sessions", message: (e as Error).message }));
    return NextResponse.json({ error: "Could not load sessions. Check the server log." }, { status: 502 });
  }
}
