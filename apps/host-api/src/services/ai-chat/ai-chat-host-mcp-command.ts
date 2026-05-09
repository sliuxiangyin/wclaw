import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { plugin } from "../plugin-catalog/plugin-catalog.service.js";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { buildWithContextWindow, sanitizeMessagesForLlmWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import { resolveCommandPluginMode } from "./ai-chat-command-plugin.js";
import { executeMcpExplicitCommand, type ParsedMcpExplicitCommand } from "./ai-chat-mcp-explicit-command.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

type HostMcpCmd = {
  targetPluginId: string;
  commandText: string;
  parsedMcp: ParsedMcpExplicitCommand;
};

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

export async function orchestrateHostMcpCommandMatched(
  ctx: AiOrchestrationContext,
  cmd: HostMcpCmd
): Promise<ChatBranchResult> {
  const target = await plugin(cmd.targetPluginId);
  if (!target?.manifest || target.status !== "valid") {
    return pluginNotFoundReply(cmd.targetPluginId);
  }
  const mode = resolveCommandPluginMode(target.manifest);
  const commandResult = await executeMcpExplicitCommand(
    cmd.commandText,
    target.manifest,
    `${cmd.targetPluginId}:${ctx.sessionId}`
  );
  if (!commandResult) {
    return {
      reply: "[mcp] 命令解析失败。",
      sourceType: "runtime",
      sourcePluginId: null,
      llmEligible: false,
      contextSummary: "mcp_parse_failed",
      skipSseFinalReplyChunks: false
    };
  }

  const summary = `command=${commandResult.command}; output=${commandResult.output}`;
  appendChatEvent({
    traceId: ctx.traceId,
    pluginId: ctx.pluginId,
    sessionId: ctx.sessionId,
    type: "chat.command.executed",
    source: "plugin",
    payload: {
      targetPluginId: cmd.targetPluginId,
      mode,
      command: commandResult.command,
      commandKind: "mcp",
      serverAlias: cmd.parsedMcp.serverAlias,
      toolName: cmd.parsedMcp.toolName
    }
  });

  if (mode === "ephemeral_with_context") {
    const llmMessages = sanitizeMessagesForLlmWindow(buildWithContextWindow(ctx.messages, 12));
    const pluginPrefix = `[plugin:${cmd.targetPluginId}] ${commandResult.output}\n`;
    const pluginSystemPrompt = target.manifest.systemPrompt;
    const baseMessages = [
      ...(pluginSystemPrompt ? [{ role: "system" as const, content: pluginSystemPrompt }] : []),
      ...llmMessages,
      {
        role: "assistant" as const,
        content: `command result: ${commandResult.output}`
      }
    ];
    appendChatEvent({
      traceId: ctx.traceId,
      pluginId: ctx.pluginId,
      sessionId: ctx.sessionId,
      type: "chat.llm.called",
      source: "llm",
      payload: {
        path: "host_mcp_command_ephemeral_with_context",
        targetPluginId: cmd.targetPluginId,
        messageCount: llmMessages.length,
        model: ctx.model ?? null
      }
    });
    let llm;
    try {
      ctx.stream?.onStart?.({ sourceType: "plugin", sourcePluginId: cmd.targetPluginId });
      if (ctx.stream?.onTextDelta) {
        ctx.stream.onTextDelta(pluginPrefix);
        llm = await streamWithConfiguredLlm({
          modelOverride: ctx.model,
          messages: baseMessages,
          onTextDelta: ctx.stream.onTextDelta,
          abortSignal: ctx.abortSignal
        });
      } else {
        llm = await generateWithConfiguredLlm({
          modelOverride: ctx.model,
          messages: baseMessages,
          abortSignal: ctx.abortSignal
        });
      }
    } catch (error) {
      appendLlmFailedEvent({
        traceId: ctx.traceId,
        pluginId: ctx.pluginId,
        sessionId: ctx.sessionId,
        path: "host_mcp_command_ephemeral_with_context",
        model: ctx.model,
        targetPluginId: cmd.targetPluginId,
        error
      });
      throw error;
    }
    return {
      reply: `${pluginPrefix}${llm.text}`,
      sourceType: "plugin",
      sourcePluginId: cmd.targetPluginId,
      llmEligible: true,
      contextSummary: summary,
      skipSseFinalReplyChunks: Boolean(ctx.stream?.onTextDelta)
    };
  }

  return {
    reply: `[plugin:${cmd.targetPluginId}] ${commandResult.output}`,
    sourceType: "plugin",
    sourcePluginId: cmd.targetPluginId,
    llmEligible: true,
    contextSummary: summary,
    skipSseFinalReplyChunks: false
  };
}
