import { NextResponse } from "next/server";
import { redirectUri } from "@/lib/base-url";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A plain HTML form posts here, so it cannot send the custom header; the Origin check alone stops cross-site logout.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let same = false;
  try { same = !!origin && !!host && new URL(origin).host === host; } catch { same = false; }
  if (!same) return NextResponse.json({ error: "Request blocked." }, { status: 403 });
  const res = NextResponse.redirect(new URL("/auth/login", redirectUri(req)), 303);
  // Expire with the same attributes it was set with; a __Host- cookie is ignored unless Secure + Path=/ are present.
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}
