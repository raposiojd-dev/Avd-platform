import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { z } from "zod";
import { getEnv } from "./env";

// Everything that identifies the customer's Entra app registration lives here, entered on the Setup page and
// never in the repo or in a config file. In Azure it is ONE Key Vault secret (read and written with the web
// app's managed identity). For local development it falls back to a git-ignored file under .data/.

const guid = z.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "must be a GUID like 12345678-1234-1234-1234-123456789abc");

export const settingsInput = z.object({
  tenantId: guid,
  clientId: guid,
  clientSecret: z.string().trim().min(8, "looks too short to be a client secret value").max(512),
  bootstrapAdminUpn: z.string().trim().toLowerCase().email("must be an email address"),
});

export interface AppSettings {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Base64 key that signs session cookies. Rotating it signs everyone out. */
  sessionKey: string;
  /** The person who completed setup. Always treated as Admin so you cannot lock yourself out. */
  bootstrapAdminUpn: string;
  configuredAtUtc: string;
}

const SECRET_NAME = "tidewatch-settings";
const g = globalThis as unknown as { __settings?: { at: number; value: AppSettings | null } };
const TTL_MS = 30_000;

function vault(): SecretClient | null {
  const env = getEnv();
  if (!env.KEY_VAULT_URI) return null;
  const clientId = env.AZURE_CLIENT_ID;
  return new SecretClient(env.KEY_VAULT_URI, new DefaultAzureCredential(clientId ? { managedIdentityClientId: clientId } : {}));
}

// Local development only. In production there is no file fallback: settings must live in Key Vault, so a missing
// KEY_VAULT_URI is a loud error rather than quietly writing a client secret to the web app's disk.
function filePath(): string {
  if (process.env.NODE_ENV === "production") throw new Error("KEY_VAULT_URI is not set. In production the settings are stored in Key Vault.");
  return getEnv().SETTINGS_FILE ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "settings.json");
}

async function read(): Promise<AppSettings | null> {
  const kv = vault();
  if (kv) {
    try {
      const s = await kv.getSecret(SECRET_NAME);
      return s.value ? (JSON.parse(s.value) as AppSettings) : null;
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null;
      throw e;
    }
  }
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ filePath(), "utf8")) as AppSettings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function write(s: AppSettings): Promise<void> {
  const kv = vault();
  if (kv) {
    await kv.setSecret(SECRET_NAME, JSON.stringify(s), { contentType: "application/json" });
    return;
  }
  const f = filePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(f), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ f, JSON.stringify(s), { mode: 0o600 });
}

export async function getSettings(force = false): Promise<AppSettings | null> {
  if (!force && g.__settings && Date.now() - g.__settings.at < TTL_MS) return g.__settings.value;
  const value = await read();
  g.__settings = { at: Date.now(), value };
  return value;
}

export async function saveSettings(input: z.infer<typeof settingsInput>, opts: { rotateSessionKey?: boolean } = {}): Promise<AppSettings> {
  const prev = await getSettings(true);
  const next: AppSettings = {
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    bootstrapAdminUpn: input.bootstrapAdminUpn,
    sessionKey: !prev || opts.rotateSessionKey ? randomBytes(32).toString("base64") : prev.sessionKey,
    configuredAtUtc: prev?.configuredAtUtc ?? new Date().toISOString(),
  };
  await write(next);
  g.__settings = { at: Date.now(), value: next };
  return next;
}

/** Only the non-secret parts, safe to send to an Admin's browser. The secret is never returned. */
export function publicView(s: AppSettings) {
  return { tenantId: s.tenantId, clientId: s.clientId, secretSet: s.clientSecret.length > 0, bootstrapAdminUpn: s.bootstrapAdminUpn, configuredAtUtc: s.configuredAtUtc };
}
