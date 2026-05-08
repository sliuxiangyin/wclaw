import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { appendChatEvent } from "../../repositories/chat-event.repository.js";
import type { McpToolForbidden } from "../../repositories/chat-session.repository.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { jsonSchema, type ToolSet } from "ai";
import { generateWithConfiguredLlm, streamWithConfiguredLlm } from "../llm/llm-runtime.service.js";
import { createMcpGatewayService } from "../mcp-gateway/mcp-gateway.service.js";
import { buildWithContextWindow } from "./ai-chat-context-window.js";
import { appendLlmFailedEvent } from "./ai-chat-events.util.js";
import type { AiChatStreamCallbacks, ChatBranchResult, UiChatMessage } from "./ai-chat.types.js";

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
  mcpToolForbidden: McpToolForbidden,
  userMessage: string,
  messages: UiChatMessage[],
  model?: string,
  traceId?: string | null,
  abortSignal?: AbortSignal,
  stream?: AiChatStreamCallbacks
): Promise<ChatBranchResult> {
  // 其余场景：runtime_default 路径下改由宿主 LLM 回答。
  const llmMessages = buildWithContextWindow(messages, 20);
  const { tools: llmTools, stats: toolStats } = buildRuntimeDefaultLlmTools(manifest, mcpToolForbidden, sessionId, traceId);
  appendChatEvent({
    traceId,
    pluginId,
    sessionId,
    type: "chat.llm.called",
    source: "llm",
    payload: {
      path: "runtime_default_llm",
      messageCount: llmMessages.length,
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
        messages: llmMessages,
        onTextDelta: stream.onTextDelta,
        onChunk: stream.onLlmChunk,
        tools: llmTools,
        abortSignal
      });
    } else {
      llm = await generateWithConfiguredLlm({
        modelOverride: model,
        messages: llmMessages,
        tools: llmTools,
        abortSignal
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

function buildRuntimeDefaultLlmTools(
  manifest: PluginManifest,
  mcpToolForbidden: McpToolForbidden,
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
  const allowedServerSet = new Set(allowedServers);
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
    if (!allowedServerSet.has(t.serverId)) continue;
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
          contextKey: sessionId
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
