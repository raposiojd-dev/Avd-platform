import { NextResponse } from "next/server";
import { z } from "zod";
import { actionsEnabled, performHostAction } from "@/lib/actions";
import { assertSameOriginMutation, requireRole } from "@/lib/guard";

export const dynamic = "force-dynamic";

const body = z.object({
  hostId: z.string().min(1).max(600),
  action: z.enum(["drain", "undrain", "restart", "deallocate", "start"]),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const blocked = assertSameOriginMutation(req);
  if (blocked) return blocked;
  const auth = await requireRole("Operator");
  if ("error" in auth) return auth.error;
  if (!actionsEnabled()) return NextResponse.json({ ok: false, message: "Actions are turned off for this deployment." }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });

  const result = await performHostAction(auth.principal, parsed.data.hostId, parsed.data.action, parsed.data.force ?? false);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
