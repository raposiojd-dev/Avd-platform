import { NextResponse } from "next/server";
import { redirectUri } from "@/lib/base-url";
import { startLogin } from "@/lib/entra";
import { getEnv } from "@/lib/env";
import { LOGIN_COOKIE, safeReturnTo, signLoginState } from "@/lib/session";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = new URL(redirectUri(req)).origin;
  if (getEnv().FLEET_PROVIDER === "demo") return NextResponse.redirect(`${origin}/`);
  const settings = await getSettings();
  if (!settings) return NextResponse.redirect(`${origin}/setup`);

  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const { url: authUrl, state, nonce, verifier } = await startLogin(settings, redirectUri(req));
  const res = NextResponse.redirect(authUrl);
  res.cookies.set(LOGIN_COOKIE, await signLoginState({ state, nonce, verifier, returnTo }, settings.sessionKey), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
