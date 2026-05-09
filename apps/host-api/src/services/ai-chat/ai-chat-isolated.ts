import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { saveChatSessionState, type ChatSessionState } from "../../repositories/chat-session.repository.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

/**
 * 会话已处在「command_plugin 隔离」：路由见 `AiChatCommandEnvelope`（`/close` 退出；有斜杠命令走 `host_command`；否则仅宿主 LLM + 隔离目标插件 manifest）。
 */

/** `/close`：清隔离态并打点（fromPluginId 取退出前的插件） */
export function orchestrateIsolatedClose(ctx: AiOrchestrationContext): { state: ChatSessionState; branch: ChatBranchResult } {
  const exitedFrom = ctx.state.isolatedPluginId;
  const state: ChatSessionState = { ...ctx.state, mode: "normal", isolatedPluginId: null };
  saveChatSessionState({
    pluginId: state.pluginId,
    sessionId: state.sessionId,
    mode: state.mode,
    isolatedPluginId: state.isolatedPluginId,
    mcpToolForbidden: state.mcpToolForbidden
  });
  appendChatEvent({
    traceId: ctx.traceId,
    pluginId: ctx.pluginId,
    sessionId: ctx.sessionId,
    type: "chat.mode.exited_isolated",
    source: "host",
    payload: { fromPluginId: exitedFrom }
  });
  return {
    state,
    branch: {
      reply: "已退出插件上下文隔离。",
      sourceType: "runtime",
      sourcePluginId: null,
      llmEligible: true,
      contextSummary: null,
      skipSseFinalReplyChunks: false
    }
  };
}
