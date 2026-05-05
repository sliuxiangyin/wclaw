import { createContext, useContext, type ReactNode } from "react";
import type { PluginActivityPayload } from "@/lib/api/ai-chat.api";

const PluginStreamActivityContext = createContext<readonly PluginActivityPayload[]>([]);

export function PluginStreamActivityProvider({
  activities,
  children
}: {
  activities: readonly PluginActivityPayload[];
  children?: ReactNode;
}) {
  return (
    <PluginStreamActivityContext.Provider value={activities}>{children}</PluginStreamActivityContext.Provider>
  );
}

export function usePluginStreamActivities(): readonly PluginActivityPayload[] {
  return useContext(PluginStreamActivityContext);
}
