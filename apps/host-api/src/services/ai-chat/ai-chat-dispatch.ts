import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import { plugin } from "../plugin-catalog/plugin-catalog.service.js";
import { orchestrateHostCommandMatched } from "./ai-chat-host-command.js";
import { orchestrateHostMcpCommandMatched } from "./ai-chat-host-mcp-command.js";
import { orchestrateIsolatedClose } from "./ai-chat-isolated.js";
import type { AiOrchestrationPath } from "./ai-chat-command-envelope.js";
import { executeRuntimeDefault } from "./ai-chat-runtime-default.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

function hostEnvelopeInvalidBranch(): ChatBranchResult {
  return {
    reply: "命令格式错误。用法：/command <pluginId> [args]",
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: false,
    contextSummary: "invalid_command_format",
    skipSseFinalReplyChunks: false
  };
}

function hostMcpCrossPluginForbiddenBranch(): ChatBranchResult {
  return {
    reply: "MCP 仅允许调用当前会话插件声明的工具。请直接使用：/mcp <server> <tool> {json}",
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: false,
    contextSummary: "mcp_cross_plugin_forbidden",
    skipSseFinalReplyChunks: false
  };
}

function commandPluginUsageHintBranch(pluginDisplayName: string, pluginId: string): ChatBranchResult {
  const label = pluginDisplayName.trim() || pluginId;
  return {
    reply:
      `「${label}」为命令插件（无上下文模式，不经过宿主大模型闲聊）。请用显式命令执行插件：\n\n` +
      `• 长格式：/command <pluginId> [参数]\n` +
      `• 短格式：/<pluginId> [参数]，或在当前插件上下文中使用 /子命令 参数\n\n` +
      `仅发送普通文本不会调用 executeTurn，也不会执行插件命令。`,
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: false,
    contextSummary: "command_plugin_usage_hint",
    skipSseFinalReplyChunks: false
  };
}

/** 根据 `resolveAiOrchestrationPath` 的判别执行对应分支（唯一允许集中 `switch` 之处） */
export async function dispatchAiOrchestration(
  path: AiOrchestrationPath,
  ctx: AiOrchestrationContext
): Promise<{ state: ChatSessionState; branch: ChatBranchResult }> {
  switch (path.kind) {
    case "isolated_close":
      return orchestrateIsolatedClose(ctx);
    case "isolated_plain_llm": {
      const row = await plugin(path.isolatedPluginId);
      if (!row?.manifest || row.status !== "valid") {
        return {
          state: ctx.state,
          branch: {
            reply: `隔离目标插件不可用：${path.isolatedPluginId}`,
            sourceType: "runtime",
            sourcePluginId: null,
            llmEligible: false,
            contextSummary: "isolated_plugin_missing",
            skipSseFinalReplyChunks: false
          }
        };
      }
      return {
        state: ctx.state,
        branch: await executeRuntimeDefault(
          ctx.pluginRuntime,
          row.manifest,
          ctx.pluginId,
          ctx.sessionId,
          ctx.state.mcpToolForbidden,
          ctx.userMessage,
          ctx.messages,
          ctx.model,
          ctx.traceId,
          ctx.abortSignal,
          ctx.stream,
          { telemetryPath: "isolated_plain_llm" }
        )
      };
    }
    case "command_plugin_usage_hint":
      return {
        state: ctx.state,
        branch: commandPluginUsageHintBranch(ctx.hostManifest.displayName, ctx.pluginId)
      };
    case "host_bad_format":
      return { state: ctx.state, branch: hostEnvelopeInvalidBranch() };
    case "host_mcp_cross_plugin_forbidden":
      return { state: ctx.state, branch: hostMcpCrossPluginForbiddenBranch() };
    case "host_command":
      return orchestrateHostCommandMatched(ctx, {
        targetPluginId: path.targetPluginId,
        commandText: path.commandText
      });
    case "host_mcp_command":
      return {
        state: ctx.state,
        branch: await orchestrateHostMcpCommandMatched(ctx, {
          targetPluginId: path.targetPluginId,
          commandText: path.commandText,
          parsedMcp: path.parsedMcp
        })
      };
    case "runtime_default":
      return {
        state: ctx.state,
        branch: await executeRuntimeDefault(
          ctx.pluginRuntime,
          ctx.hostManifest,
          ctx.pluginId,
          ctx.sessionId,
          ctx.state.mcpToolForbidden,
          ctx.userMessage,
          ctx.messages,
          ctx.model,
          ctx.traceId,
          ctx.abortSignal,
          ctx.stream
        )
      };
  }
}
