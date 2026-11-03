import { getEnv } from "../env";
import { azureProvider } from "./azure";
import { demoProvider } from "./demo";
import type { FleetProvider } from "./provider";

export function getProvider(): FleetProvider {
  return getEnv().FLEET_PROVIDER === "azure" ? azureProvider : demoProvider;
}
