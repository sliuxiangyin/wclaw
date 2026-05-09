import type { UIMessage } from "ai";
import { listUiMessages } from "../../repositories/plugin-chat.repository.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";

function clampTimelineLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > 500) return 500;
  return n;
}

export function getPluginChatHistoryTimeline(input: {
  pluginId: string;
  sessionId: string;
  limit?: number;
}): {
  pluginId: string;
  sessionId: string;
  limit: number;
  messages: UIMessage[];
} {
  assertPluginChatSessionId(input.pluginId, input.sessionId);
  const limit = clampTimelineLimit(input.limit);
  return {
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    limit,
    messages: listUiMessages(input.pluginId, input.sessionId, limit)
  };
}
