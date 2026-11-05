import type { ReactNode } from "react";
import { FleetProvider } from "@/components/fleet-context";
import { Shell } from "@/components/shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <FleetProvider>
      <Shell>{children}</Shell>
    </FleetProvider>
  );
}
