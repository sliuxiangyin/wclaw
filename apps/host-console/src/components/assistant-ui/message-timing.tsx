import { useAuiState } from "@assistant-ui/react";

export function MessageTiming() {
  const createdAt = useAuiState((s) => s.message.createdAt);
  if (!createdAt) return null;

  const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <span className="text-xs text-muted-foreground">{time}</span>;
}
