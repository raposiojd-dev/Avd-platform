import { z } from "zod";

const schema = z.object({
  FLEET_PROVIDER: z.enum(["demo", "azure"]).default("demo"),
  AVD_SUBSCRIPTION_IDS: z.string().default(""),
  AZURE_CLIENT_ID: z.string().optional(),
  ENABLE_WEB_ACTIONS: z.enum(["true", "false"]).default("false"),
  WATCHDOG_MODE: z.enum(["Report", "Remediate"]).default("Report"),
  // "builtin": the app signs people in itself with the Entra app registration entered on the Setup page.
  // "easyauth": App Service Authentication does it and the app trusts its header. Only use easyauth when the
  // site is configured to require authentication, otherwise the header can be forged.
  AUTH_MODE: z.enum(["builtin", "easyauth"]).default("builtin"),
  KEY_VAULT_URI: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  SETTINGS_FILE: z.string().optional(),
});

/** True when running on an Azure host. Demo mode (no sign-in, fake data) is refused there. */
export function isHostedInAzure(): boolean {
  return !!(process.env.WEBSITE_SITE_NAME || process.env.CONTAINER_APP_NAME || process.env.KUBERNETES_SERVICE_HOST);
}

export type AppEnv = z.infer<typeof schema> & { subscriptionIds: string[] };

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  const subscriptionIds = parsed.AVD_SUBSCRIPTION_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  if (parsed.FLEET_PROVIDER === "demo" && isHostedInAzure()) {
    // Demo mode skips sign-in and fakes data. It must never run in Azure (App Service, Container Apps, AKS).
    throw new Error("FLEET_PROVIDER=demo is not allowed when hosted in Azure. Set FLEET_PROVIDER=azure.");
  }
  if (parsed.FLEET_PROVIDER === "azure" && subscriptionIds.length === 0) {
    throw new Error("FLEET_PROVIDER=azure needs AVD_SUBSCRIPTION_IDS (comma-separated subscription ids).");
  }
  cached = { ...parsed, subscriptionIds };
  return cached;
}
