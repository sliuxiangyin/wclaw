import type { FastifyReply, FastifyRequest } from "fastify";
import type { UIMessage } from "ai";
import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import type { NotificationStreamInput } from "../core/notification.types.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { appendChatEvent } from "../repositories/chat-event.repository.js";
import { getChatSessionState } from "../repositories/chat-session.repository.js";
import { upsertUiMessage } from "../repositories/plugin-chat.repository.js";
import type { AiRunProvider } from "../providers/ai-run-provider/index.js";
import {
  consumeLlmRun,
  createAiRunStreamResponse
} from "./ai-chat-run-stream.controller.js";
import { AiChatCommandEnvelope } from "../services/ai-chat/ai-chat-command-envelope.js";
import { extractLastUserMessage } from "../services/ai-chat/ai-chat-context-window.js";
import { orchestrateChat } from "../services/ai-chat/ai-chat.service.js";
import { buildRuntimeDefaultLlmTools } from "../services/ai-chat/ai-chat-runtime-default.js";
import { validateAiChatBody, type AiChatBody } from "../routes/ai-chat-validation.js";
import {
  createTextStreamResponse,
  sendWebResponse
} from "./ai-chat-stream-response.controller.js";

type AiChatStreamRequest = FastifyRequest<{ Body: AiChatBody }>;
type PublishNotificationStream = (input: NotificationStreamInput) => void;

async function loadHostPluginOrThrow(pluginRuntime: PluginRuntimePort, pluginId: string) {
  const row = await pluginRuntime.plugin(pluginId);
  if (!row || row.status !== "valid" || !row.manifest) {
    throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
  }
  return row;
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function persistIncomingMessages(pluginId: string, sessionId: string, messages: UIMessage[], traceId: string) {
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    upsertUiMessage({
      pluginId,
      sessionId,
      message,
      traceId: message.role === "user" ? traceId : null
    });
  }
}

export async function handleAiChatStream(
  request: AiChatStreamRequest,
  reply: FastifyReply,
  pluginRuntime: PluginRuntimePort,
  aiRunProvider: AiRunProvider,
  publishNotification?: PublishNotificationStream
) {
  const body = request.body;
  const pluginId = headerString(request.headers["x-wclaw-plugin-id"]) ?? body.pluginId;
  const sessionId = headerString(request.headers["x-wclaw-session-id"]) ?? body.sessionId;
  validateAiChatBody(body, { pluginId, sessionId });
  if (!pluginId || !sessionId) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "pluginId and sessionId are required", 400);
  }

  const hostPlugin = await loadHostPluginOrThrow(pluginRuntime, pluginId);
  const messages = body.messages;
  persistIncomingMessages(pluginId, sessionId, messages, request.id);

  const userMessage = extractLastUserMessage(messages);
  const state = getChatSessionState(pluginId, sessionId);
  const path = await AiChatCommandEnvelope.handler(state, userMessage, hostPlugin);

  if (path.kind === "runtime_default" || path.kind === "isolated_plain_llm") {
    const manifest =
      path.kind === "isolated_plain_llm"
        ? (await loadHostPluginOrThrow(pluginRuntime, path.isolatedPluginId)).manifest!
        : hostPlugin.manifest!;
    const { tools: llmTools, stats: toolStats } = buildRuntimeDefaultLlmTools(
      manifest,
      state.mcpToolForbidden,
      sessionId,
      request.id
    );
    const pluginSystem =
      manifest.kind === "command_plugin" &&
      typeof manifest.systemPrompt === "string" &&
      manifest.systemPrompt.trim().length > 0
        ? manifest.systemPrompt.trim()
        : "";
    const mcpHint =
      Object.keys(llmTools).length > 0
        ? "需要浏览器或网页实时信息时，必须调用已注册的 MCP 工具。不要把历史工具展示文本当作新的工具结果，也不要用伪造的 [tool ...] 文本冒充工具调用。"
        : "";

    appendChatEvent({
      traceId: request.id,
      pluginId,
      sessionId,
      type: "chat.llm.called",
      source: "llm",
      payload: {
        path: path.kind,
        messageCount: messages.length,
        model: body.model ?? null,
        toolAllowedCount: toolStats.allowedCount,
        toolCandidateCount: toolStats.candidateCount,
        toolDeniedByServerCount: toolStats.deniedByServerCount,
        toolDeniedByNameCount: toolStats.deniedByNameCount
      }
    });
    let run;
    try {
      run = aiRunProvider.createRun({ pluginId, sessionId, traceId: request.id });
    } catch (error) {
      if (error instanceof Error && error.message === "AI_RUN_ACTIVE") {
        throw new AppError(ERROR_CODES.CHAT_SESSION_BUSY, "当前会话正在生成回复，请等待结束后再发送。", 409);
      }
      throw error;
    }
    void consumeLlmRun({
      aiRunProvider,
      runId: run.runId,
      pluginId,
      sessionId,
      traceId: request.id,
      messages,
      system: [body.system, pluginSystem, mcpHint].filter(Boolean).join("\n\n"),
      model: body.model,
      tools: llmTools,
      mode: state.mode,
      publishNotification
    });
    const response = createAiRunStreamResponse(aiRunProvider, run.runId);
    await sendWebResponse(reply, response);
    return;
  }

  const result = await orchestrateChat({
    pluginRuntime,
    plugin: hostPlugin,
    pluginId,
    sessionId,
    messages,
    model: body.model,
    traceId: request.id,
    turnSource: "web",
    sessionConcurrency: "web_fail_fast",
    persistMessages: false
  });
  await sendWebResponse(
    reply,
    createTextStreamResponse({
      text: result.reply,
      pluginId,
      sessionId,
      traceId: request.id,
      sourceType: result.sourceType,
      sourcePluginId: result.sourcePluginId,
      llmEligible: result.llmEligible,
      contextSummary: result.contextSummary
    })
  );
}
