import { notFound } from "next/navigation";
import { getEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  // Once configured (or in demo mode) this page does not exist.
  if (getEnv().FLEET_PROVIDER === "demo" || (await getSettings())) notFound();
  return <SetupForm />;
}
