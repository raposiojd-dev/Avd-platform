import { ConfidentialClientApplication, CryptoProvider } from "@azure/msal-node";
import type { AppSettings } from "./settings";
import type { Principal, Role } from "./types";

// Microsoft Entra sign-in (OpenID Connect authorization code flow with PKCE) through MSAL Node.
// https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow

const AUTHORITY = "https://login.microsoftonline.com";
const ROLES: Role[] = ["Reader", "Operator", "Admin"];
const crypto = new CryptoProvider();

type Creds = Pick<AppSettings, "tenantId" | "clientId" | "clientSecret">;

const app = (c: Creds) => new ConfidentialClientApplication({ auth: { clientId: c.clientId, authority: `${AUTHORITY}/${c.tenantId}`, clientSecret: c.clientSecret } });

/** Checks the tenant, client id and secret really work together, before they are saved. */
export async function verifyCredentials(c: Creds): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await app(c).acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"], skipCache: true });
    return r?.accessToken ? { ok: true } : { ok: false, message: "Microsoft did not return a token." };
  } catch (e) {
    const err = e as { errorCode?: string; errorMessage?: string; message?: string };
    const first = (err.errorMessage ?? err.message ?? "Sign-in check failed.").split("\n")[0]!.slice(0, 220);
    return { ok: false, message: `${err.errorCode ? err.errorCode + ": " : ""}${first}` };
  }
}

export async function startLogin(c: Creds, redirectUri: string): Promise<{ url: string; state: string; nonce: string; verifier: string }> {
  const { verifier, challenge } = await crypto.generatePkceCodes();
  const state = crypto.createNewGuid();
  const nonce = crypto.createNewGuid();
  const url = await app(c).getAuthCodeUrl({ scopes: ["openid", "profile"], redirectUri, state, nonce, codeChallenge: challenge, codeChallengeMethod: "S256" });
  return { url, state, nonce, verifier };
}

export interface LoginResult { principal: Principal; upn: string }

/** Redeems the code and applies every check an ID token needs: tenant, audience, nonce. */
export async function finishLogin(c: Creds, redirectUri: string, code: string, verifier: string, expectedNonce: string): Promise<LoginResult> {
  const r = await app(c).acquireTokenByCode({ code, redirectUri, scopes: ["openid", "profile"], codeVerifier: verifier });
  const claims = (r?.idTokenClaims ?? {}) as Record<string, unknown>;
  if (claims.tid !== c.tenantId) throw new Error("tenant mismatch");
  if (claims.aud !== c.clientId) throw new Error("audience mismatch");
  if (claims.nonce !== expectedNonce) throw new Error("nonce mismatch");
  const oid = typeof claims.oid === "string" ? claims.oid : "";
  if (!oid) throw new Error("no object id");
  const upn = String(claims.preferred_username ?? claims.upn ?? "").toLowerCase();
  const roles = (Array.isArray(claims.roles) ? claims.roles : []).filter((x): x is Role => ROLES.includes(x as Role));
  return { principal: { id: oid, name: String(claims.name ?? upn ?? "unknown"), roles }, upn };
}

/** App roles from Entra, plus Admin for the person who completed setup. */
export function withBootstrapAdmin(p: Principal, upn: string, bootstrapAdminUpn: string): Principal {
  if (upn && upn === bootstrapAdminUpn.toLowerCase() && !p.roles.includes("Admin")) return { ...p, roles: [...p.roles, "Admin"] };
  return p;
}
