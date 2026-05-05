import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { callExecuteTurn } from "../plugin-chat/plugin-chat.service.js";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { buildWithContextWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import type { AiChatStreamCallbacks, ChatBranchResult, UiChatMessage } from "./ai-chat.types.js";
import { resolveSessionForceExecuteTurnDecision } from "./session-persistence-policy.service.js";

/**
 * 非宿主 /command、非隔离内：runtime_plugin 默认路径。
 * — 多会话默认引导：只做插件运行时（不写库由 orchestrate 统一写）
 * — 插件内斜杠命令：同上
 * — 否则：走宿主配置 LLM
 */
export async function executeRuntimeDefault(
  pluginRuntime: PluginRuntimePort,
  manifest: PluginManifest,
  pluginId: string,
  sessionId: string,
  userMessage: string,
  messages: UiChatMessage[],
  model?: string,
  traceId?: string | null,
  stream?: AiChatStreamCallbacks
): Promise<ChatBranchResult> {
  // 其余场景：runtime_default 路径下改由宿主 LLM 回答。
  const llmMessages = buildWithContextWindow(messages, 20);
  appendChatEvent({
    traceId,
    pluginId,
    sessionId,
    type: "chat.llm.called",
    source: "llm",
    payload: {
      path: "runtime_default_llm",
      messageCount: llmMessages.length,
      model: model ?? null
    }
  });
  let llm;
  let skipSseFinalReplyChunks = false;
  try {
    stream?.onStart?.({ sourceType: "runtime", sourcePluginId: null });
    if (stream?.onTextDelta) {
      skipSseFinalReplyChunks = true;
      llm = await streamWithConfiguredLlm({
        modelOverride: model,
        messages: llmMessages,
        onTextDelta: stream.onTextDelta
      });
    } else {
      llm = await generateWithConfiguredLlm({
        modelOverride: model,
        messages: llmMessages
      });
    }
  } catch (error) {
    appendLlmFailedEvent({
      traceId,
      pluginId,
      sessionId,
      path: "runtime_default_llm",
      model,
      error
    });
    throw error;
  }
  return {
    reply: llm.text,
    sourceType: "runtime" as const,
    sourcePluginId: null,
    llmEligible: true,
    contextSummary: null,
    skipSseFinalReplyChunks
  };
}
