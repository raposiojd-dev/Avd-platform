import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("Reader");
  if ("error" in auth) return auth.error;
  return NextResponse.json({ entries: listAudit() });
}
