import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import { chunkText } from "./ai-chat-sse.util.js";
import { toAiChatErrorPayload, type AiChatBody } from "./ai-chat-validation.js";
import { orchestrateChat } from "../services/ai-chat/ai-chat.service.js";
import { appendChatMessage } from "../repositories/plugin-chat.repository.js";
import {
  persistRunChunkForAiChat
} from "../services/plugin-chat/plugin-chat-activity.service.js";
import { AiRunProvider } from "../providers/ai-run-provider/index.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";

async function loadHostPluginOrThrow(pluginRuntime: PluginRuntimePort, pluginId: string) {
  const row = await pluginRuntime.plugin(pluginId);
  if (!row || row.status !== "valid" || !row.manifest) {
    throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
  }
  return row;
}

export async function executeRun(input: {
  runProvider: AiRunProvider;
  runId: string;
  pluginRuntime: PluginRuntimePort;
  body: AiChatBody;
  traceId: string;
}) {
  const { runProvider, runId, pluginRuntime, body, traceId } = input;
  const abortSignal = runProvider.getAbortSignal(runId) ?? undefined;
  const emitChunk = (chunk: Record<string, unknown> & { type: string }) => {
    runProvider.appendChunk(runId, chunk);
    persistRunChunkForAiChat({
      pluginId: body.pluginId,
      sessionId: body.sessionId,
      traceId,
      chunk
    });
  };
  runProvider.markRunning(runId);
  emitChunk({ type: "data-trace", data: { traceId } });
  let streamStarted = false;
  let streamFinished = false;
  let streamHasDelta = false;
  let partialReply = "";
  let startMeta: { sourceType: "runtime" | "plugin"; sourcePluginId: string | null } | undefined;

  try {
    const hostPlugin = await loadHostPluginOrThrow(pluginRuntime, body.pluginId);
    const result = await orchestrateChat({
      pluginRuntime,
      plugin: hostPlugin,
      pluginId: body.pluginId,
      sessionId: body.sessionId,
      messages: body.messages,
      model: body.model,
      traceId,
      abortSignal,
      stream: {
        onStart: (meta) => {
          startMeta = meta;
        },
        onTextDelta: (delta) => {
          streamHasDelta = true;
          if (typeof delta === "string" && delta.length > 0) {
            partialReply += delta;
          }
        },
        onLlmChunk: (chunk) => {
          if (chunk.type === "start") streamStarted = true;
          if (chunk.type === "finish") streamFinished = true;
          if (chunk.type === "text-delta") streamHasDelta = true;
          emitChunk(chunk);
        },
        onPluginActivity: (payload) => {
          emitChunk({
            type: "data-plugin_activity",
            data: {
              phase: payload.phase,
              ...(payload.data ?? {})
            }
          });
        }
      }
    });

    if (abortSignal?.aborted) {
      persistCancelledPartialReply();
      runProvider.markCancelled(runId);
      if (!streamFinished) {
        emitChunk({ type: "finish-step" });
        emitChunk({
          type: "finish",
          messageMetadata: { mode: "normal", isolatedPluginId: null, cancelled: true }
        });
      }
      return;
    }

    if (!streamStarted) {
      const sourceFromStart =
        startMeta && startMeta.sourceType === "plugin" && startMeta.sourcePluginId
          ? `plugin:${startMeta.sourcePluginId}`
          : startMeta
            ? "runtime"
            : null;
      const source =
        sourceFromStart ??
        (result.sourceType === "plugin" && result.sourcePluginId ? `plugin:${result.sourcePluginId}` : "runtime");
      emitChunk({
        type: "start",
        messageMetadata: { source }
      });
      emitChunk({ type: "start-step" });
      emitChunk({ type: "text-start", id: "text-1" });
    }
    if (!streamHasDelta) {
      for (const delta of chunkText(result.reply, 64)) {
        emitChunk({ type: "text-delta", id: "text-1", delta });
      }
    } else if (!result.skipSseFinalReplyChunks && result.reply) {
      for (const delta of chunkText(result.reply, 64)) {
        emitChunk({ type: "text-delta", id: "text-1", delta });
      }
    }
    if (!streamFinished) {
      emitChunk({ type: "text-end", id: "text-1" });
      emitChunk({ type: "finish-step" });
      emitChunk({
        type: "finish",
        messageMetadata: { mode: result.mode, isolatedPluginId: result.isolatedPluginId }
      });
    }
    runProvider.markCompleted(runId);
  } catch (error) {
    if (abortSignal?.aborted) {
      persistCancelledPartialReply();
      runProvider.markCancelled(runId);
      if (!streamFinished) {
        emitChunk({ type: "finish-step" });
        emitChunk({
          type: "finish",
          messageMetadata: { mode: "normal", isolatedPluginId: null, cancelled: true }
        });
      }
      return;
    }
    const err = toAiChatErrorPayload(error);
    emitChunk({ type: "error", errorText: err.message, code: err.code });
    runProvider.markFailed(runId, err);
  }

  function persistCancelledPartialReply() {
    const content = partialReply.trim();
    if (!content) return;
    const sourceType = startMeta?.sourceType ?? "runtime";
    const sourcePluginId = startMeta?.sourcePluginId ?? null;
    appendChatMessage(body.pluginId, body.sessionId, "assistant", content, {
      traceId,
      sourceType,
      sourcePluginId,
      llmEligible: true,
      contextSummary: "cancelled_partial"
    });
  }
}
