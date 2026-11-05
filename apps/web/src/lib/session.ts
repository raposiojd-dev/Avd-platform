import { jwtVerify, SignJWT } from "jose";
import type { Principal, Role } from "./types";

// Signed (HS256) cookies. The key comes from the stored settings, so rotating it signs everyone out.

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-tw_session" : "tw_session";
export const LOGIN_COOKIE = process.env.NODE_ENV === "production" ? "__Host-tw_login" : "tw_login";
export const SESSION_HOURS = 8;
const ROLES: Role[] = ["Reader", "Operator", "Admin"];

const key = (b64: string) => Buffer.from(b64, "base64");

export async function signSession(p: Principal, sessionKey: string): Promise<string> {
  return new SignJWT({ name: p.name, roles: p.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key(sessionKey));
}

export async function verifySession(token: string, sessionKey: string): Promise<Principal | null> {
  try {
    const { payload } = await jwtVerify(token, key(sessionKey), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const roles = Array.isArray(payload.roles) ? (payload.roles as unknown[]).filter((r): r is Role => ROLES.includes(r as Role)) : [];
    return { id: payload.sub, name: typeof payload.name === "string" ? payload.name : "unknown", roles };
  } catch {
    return null;
  }
}

export interface LoginState { state: string; nonce: string; verifier: string; returnTo: string }

export async function signLoginState(s: LoginState, sessionKey: string): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key(sessionKey));
}

export async function verifyLoginState(token: string, sessionKey: string): Promise<LoginState | null> {
  try {
    const { payload } = await jwtVerify(token, key(sessionKey), { algorithms: ["HS256"] });
    const { state, nonce, verifier, returnTo } = payload as Record<string, unknown>;
    if (typeof state !== "string" || typeof nonce !== "string" || typeof verifier !== "string" || typeof returnTo !== "string") return null;
    return { state, nonce, verifier, returnTo };
  } catch {
    return null;
  }
}

/** Only local paths; blocks open redirects such as //evil.example or https://evil.example. */
export function safeReturnTo(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.includes("://")) return "/";
  return v;
}
