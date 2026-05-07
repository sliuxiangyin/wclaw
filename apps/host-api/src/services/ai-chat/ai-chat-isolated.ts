import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { saveChatSessionState, type ChatSessionState } from "../../repositories/chat-session.repository.js";
import { executeCommandPlugin } from "./ai-chat-command-plugin.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

/**
 * 会话已处在「command_plugin 隔离」：/close 退出，否则本条 user 全文作为子插件命令正文。
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

/** 隔离内命令：不改变会话 mode，交由目标 command_plugin */
export async function orchestrateIsolatedDelegate(
  ctx: AiOrchestrationContext
): Promise<{ state: ChatSessionState; branch: ChatBranchResult }> {
  const iso = ctx.state.isolatedPluginId;
  if (!iso) {
    throw new Error("isolated_delegate without isolatedPluginId");
  }
  const branch = await executeCommandPlugin({
    pluginRuntime: ctx.pluginRuntime,
    targetPluginId: iso,
    commandText: ctx.userMessage,
    messages: ctx.messages,
    model: ctx.model,
    traceId: ctx.traceId,
    hostPluginId: ctx.pluginId,
    sessionId: ctx.sessionId,
    stream: ctx.stream
  });
  return { state: ctx.state, branch };
}
