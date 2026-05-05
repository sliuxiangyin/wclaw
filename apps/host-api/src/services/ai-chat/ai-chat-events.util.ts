import { appendChatEvent } from "../../repositories/chat-event.repository.js";

/** 记录 LLM 调用失败，便于排障与审计 */
export function appendLlmFailedEvent(input: {
  traceId?: string | null;
  pluginId: string;
  sessionId: string;
  path: string;
  model?: string;
  targetPluginId?: string;
  error: unknown;
}) {
  appendChatEvent({
    traceId: input.traceId,
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    type: "chat.llm.failed",
    source: "llm",
    payload: {
      path: input.path,
      model: input.model ?? null,
      targetPluginId: input.targetPluginId ?? null,
      message: input.error instanceof Error ? input.error.message : String(input.error)
    }
  });
}
