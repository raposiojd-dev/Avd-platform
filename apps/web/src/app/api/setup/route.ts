import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { redirectUri } from "@/lib/base-url";
import { verifyCredentials } from "@/lib/entra";
import { getEnv } from "@/lib/env";
import { assertSameOriginMutation } from "@/lib/guard";
import { retireSetupCode, ensureSetupCode, verifySetupCode } from "@/lib/setup-code";
import { getSettings, saveSettings, settingsInput } from "@/lib/settings";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET: is the site configured, and (if not) what redirect URI does the app registration need?
export async function GET(req: Request) {
  const configured = !!(await getSettings());
  if (configured) return NextResponse.json({ configured: true });
  ensureSetupCode(); // prints the code to the server log the first time the Setup page is opened
  return NextResponse.json({ configured: false, redirectUri: redirectUri(req) });
}

// POST: the one-time setup. Allowed only while unconfigured, only with the setup code, only over HTTPS in production.
export async function POST(req: Request) {
  const blocked = assertSameOriginMutation(req);
  if (blocked) return blocked;
  if (getEnv().FLEET_PROVIDER === "demo") return NextResponse.json({ error: "Setup is not used in demo mode." }, { status: 400 });
  if (process.env.NODE_ENV === "production" && (req.headers.get("x-forwarded-proto") ?? "https") !== "https") {
    return NextResponse.json({ error: "Setup is only allowed over HTTPS." }, { status: 400 });
  }
  if (await getSettings(true)) return NextResponse.json({ error: "This site is already set up." }, { status: 409 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = z.object({ setupCode: z.string().min(1).max(200) }).and(settingsInput).safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `${issue?.path.join(".") || "request"}: ${issue?.message ?? "invalid"}` }, { status: 400 });
  }

  const code = verifySetupCode(parsed.data.setupCode);
  if (!code.ok) {
    console.log(JSON.stringify({ type: "setup", outcome: code.reason }));
    return code.reason === "locked"
      ? NextResponse.json({ error: `Too many wrong codes. Try again in ${Math.ceil((code.retryAfterSeconds ?? 900) / 60)} minutes.` }, { status: 429 })
      : NextResponse.json({ error: "That setup code is not right. Find it in the app's log stream." }, { status: 403 });
  }

  const check = await verifyCredentials(parsed.data);
  if (!check.ok) return NextResponse.json({ error: `Microsoft rejected these details. ${check.message}` }, { status: 400 });

  const { setupCode: _drop, ...input } = parsed.data;
  void _drop;
  await saveSettings(input);
  retireSetupCode();
  writeAudit({ actor: input.bootstrapAdminUpn, action: "setup.completed", target: "site", outcome: "success", detail: "Entra app registration configured" });
  return NextResponse.json({ ok: true });
}
