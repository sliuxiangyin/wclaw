import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { plugin, type PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { runPluginCommand } from "../plugin-chat/plugin-chat.service.js";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { buildWithContextWindow, sanitizeMessagesForLlmWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import type { ChatBranchResult, ExecuteCommandPluginInput } from "./ai-chat.types.js";

export function resolveCommandPluginMode(
  manifest: PluginManifest
): "runtime_plugin"|"ephemeral_no_context" | "ephemeral_with_context" | "isolated_chat" {
  if (manifest.kind==="runtime_plugin") return "runtime_plugin";
  return manifest.commandMode ?? "ephemeral_no_context";
}

/** 执行 command_plugin：无上下文 / 带上下文走 LLM / isolated 仅由上层改会话态 */
export async function executeCommandPlugin(input: ExecuteCommandPluginInput): Promise<ChatBranchResult> {
  const { targetPluginId: pluginId, commandText, messages, model, traceId, hostPluginId, sessionId, stream } =
    input;
  const target = await plugin(pluginId);
  if (!target || target.status !== "valid" || !target.manifest) {
    return {
      reply: `未找到命令插件：${pluginId}`,
      sourceType: "plugin" as const,
      sourcePluginId: pluginId,
      llmEligible: true,
      contextSummary: `command=unknown; output=plugin_not_found`,
      skipSseFinalReplyChunks: false
    };
  }
  const mode = resolveCommandPluginMode(target.manifest);
  const commandResult = await runPluginCommand(
    input.pluginRuntime,
    pluginId,
    commandText || "",
    target.manifest,
    input.sessionId,
    stream
  );
  const summary = `command=${commandResult.command}; output=${commandResult.output}`;
  appendChatEvent({
    traceId,
    pluginId: hostPluginId,
    sessionId,
    type: "chat.command.executed",
    source: "plugin",
    payload: {
      targetPluginId: pluginId,
      mode,
      command: commandResult.command
    }
  });

  if (mode === "ephemeral_with_context") {
    if (!commandResult.continue) {
      return {
        reply: commandResult.output,
        sourceType: "plugin" as const,
        sourcePluginId: pluginId,
        llmEligible: true,
        contextSummary: summary,
        skipSseFinalReplyChunks: false
      };
    }

    const llmMessages = sanitizeMessagesForLlmWindow(buildWithContextWindow(messages, 12));
    const pluginSystemPrompt = target.manifest.systemPrompt;
    const pluginUserLine =
      `[plugin:${pluginId} 执行结果 — 以下内容供你组织回答，勿把原文重复粘贴给用户]\n\n${commandResult.output}`;
    const baseMessages = [
      ...(typeof pluginSystemPrompt === "string" && pluginSystemPrompt.trim().length > 0
        ? [{ role: "system" as const, content: pluginSystemPrompt.trim() }]
        : []),
      ...llmMessages,
      { role: "user" as const, content: pluginUserLine }
    ];
    appendChatEvent({
      traceId,
      pluginId: hostPluginId,
      sessionId,
      type: "chat.llm.called",
      source: "llm",
      payload: {
        path: "command_plugin_ephemeral_with_context",
        targetPluginId: pluginId,
        messageCount: llmMessages.length,
        model: model ?? null
      }
    });
    let llm;
    try {
      stream?.onStart?.({ sourceType: "plugin", sourcePluginId: pluginId });
      if (stream?.onTextDelta) {
        llm = await streamWithConfiguredLlm({
          modelOverride: model,
          messages: baseMessages,
          onTextDelta: stream.onTextDelta,
          abortSignal: input.abortSignal
        });
      } else {
        llm = await generateWithConfiguredLlm({
          modelOverride: model,
          messages: baseMessages,
          abortSignal: input.abortSignal
        });
      }
    } catch (error) {
      appendLlmFailedEvent({
        traceId,
        pluginId: hostPluginId,
        sessionId,
        path: "command_plugin_ephemeral_with_context",
        model,
        targetPluginId: pluginId,
        error
      });
      throw error;
    }
    return {
      reply: llm.text,
      sourceType: "plugin" as const,
      sourcePluginId: pluginId,
      llmEligible: true,
      contextSummary: summary,
      skipSseFinalReplyChunks: Boolean(stream?.onTextDelta)
    };
  }

  return {
    reply: `[plugin:${pluginId}] ${commandResult.output}`,
    sourceType: "plugin" as const,
    sourcePluginId: pluginId,
    llmEligible: true,
    contextSummary: summary,
    skipSseFinalReplyChunks: false
  };
}
