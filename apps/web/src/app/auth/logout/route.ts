import { NextResponse } from "next/server";
import { redirectUri } from "@/lib/base-url";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/auth/login", redirectUri(req)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
