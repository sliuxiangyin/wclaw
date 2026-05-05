import { createContext, useContext, type ReactNode } from "react";
import type { PluginActivityPayload } from "@/lib/api/ai-chat.api";

const TimelinePersistedActivitiesContext = createContext<Record<string, readonly PluginActivityPayload[]>>({});

export function TimelinePersistedActivitiesProvider({
  value,
  children
}: {
  value: Readonly<Record<string, readonly PluginActivityPayload[]>>;
  children?: ReactNode;
}) {
  return (
    <TimelinePersistedActivitiesContext.Provider value={value}>
      {children}
    </TimelinePersistedActivitiesContext.Provider>
  );
}

export function useTimelinePersistedActivities(): Readonly<
  Record<string, readonly PluginActivityPayload[]>
> {
  return useContext(TimelinePersistedActivitiesContext);
}
