import { getEnv } from "./env";

/**
 * The public address of this site, used for the sign-in redirect URI. Prefers an explicit setting, then the
 * App Service host name, and only then the request itself (local development).
 */
export function baseUrl(req?: Request): string {
  const env = getEnv();
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (process.env.WEBSITE_HOSTNAME) return `https://${process.env.WEBSITE_HOSTNAME}`;
  if (req) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export const redirectUri = (req?: Request) => `${baseUrl(req)}/auth/callback`;
