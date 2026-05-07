import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { saveChatSessionState, type ChatSessionState } from "../../repositories/chat-session.repository.js";
import { plugin } from "../plugin-catalog/plugin-catalog.service.js";
import {
  executeCommandPlugin,
  resolveCommandPluginMode
} from "./ai-chat-command-plugin.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

type HostCmd = {
  targetPluginId: string;
  commandText: string;
};

/**
 * 已匹配宿主 `/command` 信封（含合法 target）：查库、按需进入 isolated_chat 或瞬时执行命令。
 */

function pluginNotFoundReply(targetPluginId: string): ChatBranchResult {
  return {
    reply: `未找到可执行的 command_plugin：${targetPluginId}`,
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: true,
    contextSummary: null,
    skipSseFinalReplyChunks: false
  };
}

function enterIsolatedReply(targetPluginId: string): ChatBranchResult {
  return {
    reply: `已进入插件上下文隔离：${targetPluginId}`,
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: true,
    contextSummary: null,
    skipSseFinalReplyChunks: false
  };
}

export async function orchestrateHostCommandMatched(
  ctx: AiOrchestrationContext,
  cmd: HostCmd
): Promise<{ state: ChatSessionState; branch: ChatBranchResult }> {
  if (!cmd.targetPluginId.trim()) {
    return {
      state: ctx.state,
      branch: {
        reply: "命令格式错误。用法：/command <pluginId> [args]",
        sourceType: "runtime",
        sourcePluginId: null,
        llmEligible: false,
        contextSummary: "invalid_command_format",
        skipSseFinalReplyChunks: false
      }
    };
  }

  const target = await plugin(cmd.targetPluginId);
  if (!target?.manifest || target.status !== "valid" ) {
    return { state: ctx.state, branch: pluginNotFoundReply(cmd.targetPluginId) };
  }

  const mode = resolveCommandPluginMode(target.manifest);
  if (mode === "isolated_chat") {
    const state: ChatSessionState = {
      ...ctx.state,
      mode: "isolated",
      isolatedPluginId: cmd.targetPluginId
    };
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
      type: "chat.mode.entered_isolated",
      source: "host",
      payload: { isolatedPluginId: cmd.targetPluginId }
    });
    return { state, branch: enterIsolatedReply(cmd.targetPluginId) };
  }

  const branch = await executeCommandPlugin({
    pluginRuntime: ctx.pluginRuntime,
    targetPluginId: cmd.targetPluginId,
    commandText: cmd.commandText,
    messages: ctx.messages,
    model: ctx.model,
    traceId: ctx.traceId,
    hostPluginId: ctx.pluginId,
    sessionId: ctx.sessionId,
    stream: ctx.stream
  });
  return { state: ctx.state, branch };
}
