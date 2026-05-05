import type { FastifyInstance } from "fastify";
import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { listChatEvents } from "../repositories/chat-event.repository.js";
import { orchestrateChat } from "../services/ai-chat/ai-chat.service.js";
import { persistPluginActivityForAiChat } from "../services/plugin-chat/plugin-chat-activity.service.js";
import { chunkText, writeChunkSse, writeSse } from "./ai-chat-sse.util.js";
import { validateAiChatBody, toAiChatErrorPayload, type AiChatBody } from "./ai-chat-validation.js";

type AiChatEventsQuery = {
  pluginId?: string;
  sessionId?: string;
  type?: string;
  limit?: string;
  offset?: string;
};

async function loadHostPluginOrThrow(pluginRuntime: PluginRuntimePort, pluginId: string) {
  const row = await pluginRuntime.plugin(pluginId);
  if (!row || row.status !== "valid" || !row.manifest) {
    throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
  }
  return row;
}

export async function registerAiChatRoutes(app: FastifyInstance, pluginRuntime: PluginRuntimePort) {
  app.post<{ Body: AiChatBody }>("/api/ai/chat", async (request, reply) => {
    const body = request.body;
    validateAiChatBody(body);

    const wantsSse = (request.headers.accept ?? "").includes("text/event-stream");
    if (!wantsSse) {
      const hostPlugin = await loadHostPluginOrThrow(pluginRuntime, body.pluginId);
      const result = await orchestrateChat({
        pluginRuntime,
        plugin: hostPlugin,
        pluginId: body.pluginId,
        sessionId: body.sessionId,
        messages: body.messages,
        model: body.model,
        traceId: request.id
      });

      return ok(result, request.id);
    }

    request.raw.setTimeout(0);
    reply.hijack();
    const res = reply.raw;
    const requestOrigin =
      typeof request.headers.origin === "string" && request.headers.origin.length > 0
        ? request.headers.origin
        : "*";
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      Vary: "Origin",
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Credentials": "true"
    });
    writeChunkSse(res, { type: "data-trace", data: { traceId: request.id } });
    let streamStarted = false;
    let streamHasDelta = false;

    const ensureSseStarted = (meta?: { sourceType: "runtime" | "plugin"; sourcePluginId: string | null }) => {
      if (streamStarted) return;
      streamStarted = true;
      const source =
        meta && meta.sourceType === "plugin" && meta.sourcePluginId ? `plugin:${meta.sourcePluginId}` : "runtime";
      writeChunkSse(res, {
        type: "start",
        messageMetadata: { source }
      });
      writeChunkSse(res, { type: "start-step" });
      writeChunkSse(res, { type: "text-start", id: "text-1" });
    };
    const hostPlugin = await loadHostPluginOrThrow(pluginRuntime, body.pluginId);
    try {
      const result = await orchestrateChat({
        pluginRuntime,
        plugin: hostPlugin,
        pluginId: body.pluginId,
        sessionId: body.sessionId,
        messages: body.messages,
        model: body.model,
        traceId: request.id,
        stream: {
          onStart: (meta) => {
            ensureSseStarted(meta);
          },
          onTextDelta: (delta) => {
            ensureSseStarted();
            streamHasDelta = true;
            writeChunkSse(res, { type: "text-delta", id: "text-1", delta });
          },
          onPluginActivity: (payload) => {
            persistPluginActivityForAiChat({
              pluginId: body.pluginId,
              sessionId: body.sessionId,
              traceId: request.id,
              phase: payload.phase,
              data: payload.data
            });
            ensureSseStarted();
            writeChunkSse(res, {
              type: "plugin-activity",
              phase: payload.phase,
              data: payload.data ?? {}
            });
          }
        }
      });

      if (!streamStarted) {
        const source =
          result.sourceType === "plugin" && result.sourcePluginId ? `plugin:${result.sourcePluginId}` : "runtime";
        writeChunkSse(res, {
          type: "start",
          messageMetadata: { source }
        });
        writeChunkSse(res, { type: "start-step" });
        writeChunkSse(res, { type: "text-start", id: "text-1" });
      }
      if (!streamHasDelta) {
        for (const delta of chunkText(result.reply, 64)) {
          writeChunkSse(res, { type: "text-delta", id: "text-1", delta });
        }
      } else if (!result.skipSseFinalReplyChunks && result.reply) {
        for (const delta of chunkText(result.reply, 64)) {
          writeChunkSse(res, { type: "text-delta", id: "text-1", delta });
        }
      }
      writeChunkSse(res, { type: "text-end", id: "text-1" });
      writeChunkSse(res, { type: "finish-step" });
      writeChunkSse(res, {
        type: "finish",
        messageMetadata: { mode: result.mode, isolatedPluginId: result.isolatedPluginId }
      });
      res.end();
      return;
    } catch (error) {
      const err = toAiChatErrorPayload(error);
      writeSse(res, "error", err);
      res.end();
      return;
    }
  });

  app.get<{ Querystring: AiChatEventsQuery }>("/api/ai/events", async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : undefined;
    const offset = request.query.offset ? Number(request.query.offset) : undefined;
    if (request.query.limit && !Number.isFinite(limit)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "limit must be a number", 400);
    }
    if (request.query.offset && !Number.isFinite(offset)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "offset must be a number", 400);
    }

    const items = listChatEvents({
      pluginId: request.query.pluginId,
      sessionId: request.query.sessionId,
      type: request.query.type,
      limit,
      offset
    });
    return ok(
      {
        items,
        pagination: {
          limit: limit ?? 100,
          offset: offset ?? 0
        }
      },
      request.id
    );
  });
}
