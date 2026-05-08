import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import { appendPluginActivity } from "../../repositories/plugin-chat-activity.repository.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";

/**
 * Run chunk：统一按 run 主通道事件持久化，供历史按 chunk 重建 parts。
 */
export function persistRunChunkForAiChat(input: {
  pluginId: string;
  sessionId: string;
  traceId: string;
  chunk: Record<string, unknown> & { type: string };
}): void {
  const type = String(input.chunk.type ?? "").trim();
  if (!type) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "run chunk type is required", 400);
  }
  assertPluginChatSessionId(input.pluginId, input.sessionId);
  appendPluginActivity({
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    traceId: input.traceId,
    phase: "run.chunk",
    data: input.chunk
  });
}
