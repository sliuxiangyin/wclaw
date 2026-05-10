import { mcpAllowedServersAllowsServerId } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import type { McpToolForbidden } from "../../repositories/chat-session.repository.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { jsonSchema, type ToolSet } from "ai";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { createMcpGatewayService } from "../mcp-gateway/mcp-gateway.service.js";
import { buildWithContextWindow, sanitizeMessagesForLlmWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import type { AiChatStreamCallbacks, ChatBranchResult, UiChatMessage } from "./ai-chat.types.js";

export type ExecuteRuntimeDefaultOptions = {
  /** 写入 `chat_events` 的 path，便于区分「隔离内纯 LLM」等 */
  telemetryPath?: string;
};

/**
 * 非宿主 /command、非隔离内的默认路径：走宿主配置 LLM。
 * `command_plugin` 且声明 `systemPrompt` 时，在窗口消息前注入一条 system（与 `executeCommandPlugin` 带上下文分支一致）。
 */
export async function executeRuntimeDefault(
  pluginRuntime: PluginRuntimePort,
  manifest: PluginManifest,
  pluginId: string,
  sessionId: string,
  mcpToolForbidden: McpToolForbidden,
  userMessage: string,
  messages: UiChatMessage[],
  model?: string,
  traceId?: string | null,
  abortSignal?: AbortSignal,
  stream?: AiChatStreamCallbacks,
  options?: ExecuteRuntimeDefaultOptions
): Promise<ChatBranchResult> {
  const telemetryPath = options?.telemetryPath ?? "runtime_default_llm";
  const windowed = sanitizeMessagesForLlmWindow(buildWithContextWindow(messages, 20));
  const pluginSystem =
    manifest.kind === "command_plugin" &&
    typeof manifest.systemPrompt === "string" &&
    manifest.systemPrompt.trim().length > 0
      ? manifest.systemPrompt.trim()
      : null;
  type LlmLine = { role: "system" | "user" | "assistant"; content: string };
  const llmMessages: LlmLine[] = pluginSystem
    ? [{ role: "system", content: pluginSystem }, ...(windowed as LlmLine[])]
    : (windowed as LlmLine[]);

  if (manifest.kind === "command_plugin") {
    const spRaw = typeof manifest.systemPrompt === "string" ? manifest.systemPrompt.trim() : "";
    const detail = spRaw.length > 0;
    const preview = detail ? spRaw.slice(0, 200) : null;
    console.info("[ai-chat] systemPrompt (runtime_default / isolated_plain_llm)", {
      telemetryPath,
      sessionPluginId: pluginId,
      manifestId: manifest.id,
      commandMode: manifest.commandMode ?? null,
      appliedToLlm: Boolean(pluginSystem),
      reasonIfSkipped: pluginSystem
        ? null
        : !detail
          ? "manifest.systemPrompt 缺失或为空"
          : "内部状态异常",
      charLength: pluginSystem?.length ?? 0,
      previewSuffix: detail && spRaw.length > 200 ? "…" : "",
      preview
    });
  }

  const { tools: llmTools, stats: toolStats } = buildRuntimeDefaultLlmTools(
    manifest,
    mcpToolForbidden,
    pluginId,
    sessionId,
    traceId
  );

  let messagesForLlm: LlmLine[] = llmMessages;
  if (Object.keys(llmTools).length > 0) {
    const mcpHint =
      "（宿主编排：需要浏览器或网页实时信息时，必须调用已注册的 MCP 工具；历史中可能仍有被裁掉的旧工具摘要，不能代替新的工具调用；禁止用虚构的 [tool:…] 行冒充工具输出。）";
    if (messagesForLlm.length > 0 && messagesForLlm[0]!.role === "system") {
      messagesForLlm = [
        { role: "system", content: `${messagesForLlm[0]!.content}\n\n${mcpHint}` },
        ...messagesForLlm.slice(1)
      ];
    } else {
      messagesForLlm = [{ role: "system", content: mcpHint }, ...messagesForLlm];
    }
  }

  appendChatEvent({
    traceId,
    pluginId,
    sessionId,
    type: "chat.llm.called",
    source: "llm",
    payload: {
      path: telemetryPath,
      messageCount: messagesForLlm.length,
      model: model ?? null,
      toolAllowedCount: toolStats.allowedCount,
      toolCandidateCount: toolStats.candidateCount,
      toolDeniedByServerCount: toolStats.deniedByServerCount,
      toolDeniedByNameCount: toolStats.deniedByNameCount
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
        messages: messagesForLlm,
        onTextDelta: stream.onTextDelta,
        onChunk: stream.onLlmChunk,
        tools: llmTools,
        abortSignal
      });
    } else {
      llm = await generateWithConfiguredLlm({
        modelOverride: model,
        messages: messagesForLlm,
        tools: llmTools,
        abortSignal
      });
    }
  } catch (error) {
    appendLlmFailedEvent({
      traceId,
      pluginId,
      sessionId,
      path: telemetryPath,
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

export function buildRuntimeDefaultLlmTools(
  manifest: PluginManifest,
  mcpToolForbidden: McpToolForbidden,
  pluginId: string,
  sessionId: string,
  traceId?: string | null
): {
  tools: ToolSet;
  stats: {
    candidateCount: number;
    allowedCount: number;
    deniedByServerCount: number;
    deniedByNameCount: number;
  };
} {
  const allowedServers = manifest.mcp?.allowedServers ?? [];
  if (allowedServers.length === 0) {
    return {
      tools: {},
      stats: { candidateCount: 0, allowedCount: 0, deniedByServerCount: 0, deniedByNameCount: 0 }
    };
  }

  const gateway = createMcpGatewayService();
  const catalog = gateway.buildCatalog();
  const forbiddenServerSet = new Set(mcpToolForbidden.servers);
  const forbiddenToolsByServer: Record<string, Set<string>> = {};
  for (const [serverId, toolNames] of Object.entries(mcpToolForbidden.tools)) {
    forbiddenToolsByServer[serverId] = new Set(toolNames);
  }

  let candidateCount = 0;
  let deniedByServerCount = 0;
  let deniedByNameCount = 0;
  const tools: Record<
    string,
    { description?: string; inputSchema: ReturnType<typeof jsonSchema>; execute: (args: unknown) => Promise<unknown> }
  > = {};

  for (const t of catalog.tools) {
    if (!mcpAllowedServersAllowsServerId(t.serverId, allowedServers)) continue;
    candidateCount += 1;
    if (forbiddenServerSet.has(t.serverId)) {
      deniedByServerCount += 1;
      continue;
    }
    const forbiddenNames = forbiddenToolsByServer[t.serverId];
    if (forbiddenNames?.has(t.name)) {
      deniedByNameCount += 1;
      continue;
    }

    const toolKey = `${t.serverId}__${t.name}`;
    let inputSchema: Record<string, unknown> = {
      type: "object",
      additionalProperties: true
    };
    try {
      const schema = gateway.getToolSchemaFromSnapshot(t.serverId, t.name);
      if (schema && typeof schema === "object" && !Array.isArray(schema)) {
        inputSchema = schema;
      }
    } catch {
      // probe 未产出 schema 时使用宽松 schema，避免阻断默认对话流程
    }

    tools[toolKey] = {
      description: `[mcp ${t.serverId}/${t.name}] ${t.description ?? ""}`.trim(),
      inputSchema: jsonSchema(inputSchema),
      execute: async (args: unknown) =>
        gateway.invokeTool({
          toolId: `${t.serverId}/${t.name}`,
          arguments: normalizeToolArgs(args),
          traceId,
          contextKey: `${pluginId}:${sessionId}`
        })
    };
  }

  return {
    tools,
    stats: {
      candidateCount,
      allowedCount: Object.keys(tools).length,
      deniedByServerCount,
      deniedByNameCount
    }
  };
}

function normalizeToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}
