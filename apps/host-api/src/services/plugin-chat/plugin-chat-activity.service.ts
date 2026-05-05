import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import { appendPluginActivity } from "../../repositories/plugin-chat-activity.repository.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";

/**
 * 插件活动：先落库（供历史与 LLM 隔离）；由路由在写 SSE 前调用。
 * LLM 上下文不得读取本表；仅 `plugin_chat_messages` 参与组装。
 */
export function persistPluginActivityForAiChat(input: {
  pluginId: string;
  sessionId: string;
  traceId: string;
  phase: string;
  data?: Record<string, unknown>;
}): void {
  const phase = String(input.phase ?? "").trim();
  if (!phase) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "activity phase is required", 400);
  }
  assertPluginChatSessionId(input.pluginId, input.sessionId);
  appendPluginActivity({
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    traceId: input.traceId,
    phase,
    data: input.data ?? {}
  });
}
