import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { redirectUri } from "@/lib/base-url";
import { verifyCredentials } from "@/lib/entra";
import { assertSameOriginMutation, requireRole } from "@/lib/guard";
import { getSettings, publicView, saveSettings, settingsInput } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRole("Admin");
  if ("error" in auth) return auth.error;
  const s = await getSettings();
  if (!s) return NextResponse.json({ error: "Not set up." }, { status: 404 });
  return NextResponse.json({ ...publicView(s), redirectUri: redirectUri(req) });
}

// Admin-only. The secret is optional here: leave it blank to keep the stored one.
export async function PUT(req: Request) {
  const blocked = assertSameOriginMutation(req);
  if (blocked) return blocked;
  const auth = await requireRole("Admin");
  if ("error" in auth) return auth.error;
  const current = await getSettings(true);
  if (!current) return NextResponse.json({ error: "Not set up." }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const raw = (body ?? {}) as Record<string, unknown>;
  const rotate = raw.rotateSessions === true;
  const merged = { ...raw, clientSecret: typeof raw.clientSecret === "string" && raw.clientSecret.trim() ? raw.clientSecret : current.clientSecret };
  const parsed = settingsInput.and(z.object({ rotateSessions: z.boolean().optional() })).safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path.join(".") || "request"}: ${issue?.message ?? "invalid"}` }, { status: 400 });
  }
  const { rotateSessions: _r, ...input } = parsed.data;
  void _r;
  const credsChanged = input.tenantId !== current.tenantId || input.clientId !== current.clientId || input.clientSecret !== current.clientSecret;
  if (credsChanged) {
    const check = await verifyCredentials(input);
    if (!check.ok) return NextResponse.json({ error: `Microsoft rejected these details. ${check.message}` }, { status: 400 });
  }
  const saved = await saveSettings(input, { rotateSessionKey: rotate });
  writeAudit({ actor: auth.principal.name, action: rotate ? "settings.signout-everyone" : "settings.updated", target: "site", outcome: "success", detail: credsChanged ? "Entra details changed" : "No credential change" });
  return NextResponse.json({ ...publicView(saved), redirectUri: redirectUri(req), signedOutEveryone: rotate });
}
