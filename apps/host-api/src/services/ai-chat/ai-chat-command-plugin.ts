import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import { plugin, type PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { runPluginCommand } from "../plugin-chat/plugin-chat.service.js";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { createMcpGatewayService } from "../mcp-gateway/mcp-gateway.service.js";
import { buildWithContextWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import type { ChatBranchResult, ExecuteCommandPluginInput } from "./ai-chat.types.js";

export function resolveCommandPluginMode(
  manifest: PluginManifest
): "runtime_plugin"|"ephemeral_no_context" | "ephemeral_with_context" | "isolated_chat" {
  if (manifest.kind==="runtime_plugin") return "runtime_plugin";
  if (manifest.capabilities?.isolatedContext === true) return "isolated_chat";
  if (manifest.capabilities?.commandContextWrite === "none") return "ephemeral_no_context";
  if (manifest.capabilities?.llm === true) return "ephemeral_with_context";
  return "ephemeral_no_context";
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
  //todo  maybeExecuteMcpCommand 可以迁移到 ai-chat-command-envelope 中 统一处理
  const commandResult =
    (mode === "ephemeral_no_context"
      ? null
      : await maybeExecuteMcpCommand(commandText || "", target.manifest)) ??
    (await runPluginCommand(
      input.pluginRuntime,
      pluginId,
      commandText || "",
      target.manifest,
      input.sessionId,
      stream
    ));
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
    const llmMessages = buildWithContextWindow(messages, 12);
    const pluginPrefix = `[plugin:${pluginId}] ${commandResult.output}\n`;
    const pluginSystemPrompt = target.manifest.guide?.systemPrompt;
    const baseMessages = [
      ...(pluginSystemPrompt ? [{ role: "system" as const, content: pluginSystemPrompt }] : []),
      ...llmMessages,
      {
        role: "assistant" as const,
        content: `command result: ${commandResult.output}`
      }
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
        stream.onTextDelta(pluginPrefix);
        llm = await streamWithConfiguredLlm({
          modelOverride: model,
          messages: baseMessages,
          onTextDelta: stream.onTextDelta
        });
      } else {
        llm = await generateWithConfiguredLlm({
          modelOverride: model,
          messages: baseMessages
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
      reply: `${pluginPrefix}${llm.text}`,
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

async function maybeExecuteMcpCommand(commandText: string, manifest: PluginManifest) {
  const parsed = parseMcpExplicitCommand(commandText);
  if (!parsed) {
    return null;
  }
  const allowedServers = manifest.mcp?.allowedServers ?? [];
  if (allowedServers.length === 0) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: "[mcp] 当前插件未配置 mcp.allowedServers，拒绝执行。"
    };
  }
  if (!allowedServers.includes(parsed.serverAlias)) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp] server '${parsed.serverAlias}' 不在 allowedServers 白名单中。`
    };
  }

  const gateway = createMcpGatewayService();
  const catalog = gateway.buildCatalog();
  if (parsed.toolName === "__list__") {
    const server = catalog.servers.find((s) => s.id === parsed.serverAlias);
    const tools = catalog.tools.filter((t) => t.serverId === parsed.serverAlias).map((t) => t.name);
    if (!server) {
      return {
        pluginId: manifest.id,
        command: commandText,
        output: `[mcp] server '${parsed.serverAlias}' 不存在于 catalog。`
      };
    }
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp:${parsed.serverAlias}] tools(${tools.length}): ${tools.join(", ")}`
    };
  }
  const matched = catalog.tools.filter((t) => t.serverId === parsed.serverAlias && t.name === parsed.toolName);
  if (matched.length === 0) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp] 未找到工具：${parsed.serverAlias}/${parsed.toolName}（请确认 server 在线且已探测 tools）。`
    };
  }

  const result = await gateway.invokeTool({
    toolId: `${parsed.serverAlias}/${parsed.toolName}`,
    arguments: parsed.args
  });
  return {
    pluginId: manifest.id,
    command: commandText,
    output: `[mcp:${parsed.serverAlias}/${parsed.toolName}] ${safeStringify(result)}`
  };
}

function parseMcpExplicitCommand(
  commandText: string
): { serverAlias: string; toolName: string; args: Record<string, unknown> } | null {
  const raw = String(commandText || "").trim();
  if (!raw) return null;
  const firstSplit = raw.split(/\s+/, 2);
  if (firstSplit[0] !== "mcp") return null;

  const afterPrefix = raw.slice(3).trim();
  if (!afterPrefix) {
    return { serverAlias: "", toolName: "", args: {} };
  }
  const secondSplit = afterPrefix.split(/\s+/, 2);
  const serverAlias = secondSplit[0] ?? "";
  const restAfterServer = afterPrefix.slice(serverAlias.length).trim();
  const thirdSplit = restAfterServer.split(/\s+/, 2);
  const toolName = thirdSplit[0] ?? "";
  const argsText = restAfterServer.slice(toolName.length).trim();

  let args: Record<string, unknown> = {};
  if (argsText) {
    try {
      const parsed = JSON.parse(argsText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  }
  return { serverAlias, toolName, args };
}

function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}...(truncated)` : text;
  } catch {
    return String(value);
  }
}
