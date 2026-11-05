import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { redirectUri } from "@/lib/base-url";
import { finishLogin, withBootstrapAdmin } from "@/lib/entra";
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_HOURS, signSession, verifyLoginState } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const page = (status: number, message: string) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in problem</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">We could not sign you in</h1><p>${message}</p><p><a href="/auth/login">Try again</a></p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export async function GET(req: Request) {
  const url = new URL(req.url);
  const settings = await getSettings();
  if (!settings) return NextResponse.redirect(new URL("/setup", redirectUri(req)));

  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${LOGIN_COOKIE}=`))?.slice(LOGIN_COOKIE.length + 1);
  const login = cookie ? await verifyLoginState(cookie, settings.sessionKey) : null;
  if (url.searchParams.get("error")) {
    console.log(JSON.stringify({ type: "signin", outcome: "idp-error", code: url.searchParams.get("error") }));
    return page(400, "Microsoft did not complete the sign-in.");
  }
  const code = url.searchParams.get("code");
  if (!login || !code || url.searchParams.get("state") !== login.state) return page(400, "The sign-in session expired or did not match. Please try again.");

  try {
    const r = await finishLogin(settings, redirectUri(req), code, login.verifier, login.nonce);
    const principal = withBootstrapAdmin(r.principal, r.upn, settings.bootstrapAdminUpn);
    writeAudit({ actor: r.upn || principal.id, action: "signin", target: "site", outcome: "success", detail: `roles: ${principal.roles.join(", ") || "none"}` });
    const res = NextResponse.redirect(new URL(login.returnTo, redirectUri(req)));
    res.cookies.set(SESSION_COOKIE, await signSession(principal, settings.sessionKey), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
    });
    res.cookies.delete(LOGIN_COOKIE);
    return res;
  } catch (e) {
    console.log(JSON.stringify({ type: "signin", outcome: "failed", reason: (e as Error).message.slice(0, 120) }));
    return page(400, "Sign-in could not be verified. Check the redirect URI and secret in the app registration.");
  }
}
