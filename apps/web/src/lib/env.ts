import { z } from "zod";

const schema = z.object({
  FLEET_PROVIDER: z.enum(["demo", "azure"]).default("demo"),
  AVD_SUBSCRIPTION_IDS: z.string().default(""),
  AZURE_CLIENT_ID: z.string().optional(),
  ENABLE_WEB_ACTIONS: z.enum(["true", "false"]).default("false"),
  WATCHDOG_MODE: z.enum(["Report", "Remediate"]).default("Report"),
});

export type AppEnv = z.infer<typeof schema> & { subscriptionIds: string[] };

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = schema.parse(process.env);
  const subscriptionIds = parsed.AVD_SUBSCRIPTION_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  if (parsed.FLEET_PROVIDER === "demo" && process.env.WEBSITE_SITE_NAME) {
    // Demo mode skips sign-in and fakes data. It must never run inside App Service.
    throw new Error("FLEET_PROVIDER=demo is not allowed when running in Azure App Service. Set FLEET_PROVIDER=azure.");
  }
  if (parsed.FLEET_PROVIDER === "azure" && subscriptionIds.length === 0) {
    throw new Error("FLEET_PROVIDER=azure needs AVD_SUBSCRIPTION_IDS (comma-separated subscription ids).");
  }
  cached = { ...parsed, subscriptionIds };
  return cached;
}
