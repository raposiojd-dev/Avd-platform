import { NextResponse, type NextRequest } from "next/server";

// Front door. Runs before every request. It only checks that a session cookie EXISTS so anonymous visitors are sent
// to sign in; the cookie's signature, expiry and the user's role are verified on every API call and page data load
// (lib/auth.ts), never trusted from here.

const PUBLIC = [/^\/setup(\/|$)/, /^\/api\/setup(\/|$)/, /^\/api\/health$/, /^\/auth\//, /^\/_next\//, /^\/icon\.svg$/];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-tw_session" : "tw_session";

export function proxy(req: NextRequest) {
  const hosted = !!(process.env.WEBSITE_SITE_NAME || process.env.CONTAINER_APP_NAME || process.env.KUBERNETES_SERVICE_HOST);
  if ((process.env.FLEET_PROVIDER === "demo" && !hosted) || process.env.AUTH_MODE === "easyauth") return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname)) || req.cookies.has(COOKIE)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const to = req.nextUrl.clone();
  to.pathname = "/auth/login";
  to.search = `?returnTo=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(to);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
