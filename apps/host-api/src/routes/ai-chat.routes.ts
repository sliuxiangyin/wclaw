import type { FastifyInstance } from "fastify";
import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { AiRunProvider } from "../providers/ai-run-provider/index.js";
import { listChatEvents } from "../repositories/chat-event.repository.js";
import { orchestrateChat } from "../services/ai-chat/ai-chat.service.js";
import { executeRun } from "./ai-run-executor.js";
import { validateAiChatBody, type AiChatBody } from "./ai-chat-validation.js";

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

type RunStartBody = AiChatBody;

type RunStreamParams = {
  runId: string;
};

type RunStreamQuery = {
  lastSeq?: string;
};

export async function registerAiChatRoutes(
  app: FastifyInstance,
  pluginRuntime: PluginRuntimePort,
  runProvider: AiRunProvider
) {
  app.post<{ Body: AiChatBody }>("/api/ai/chat", async (request, reply) => {
    const body = request.body;
    validateAiChatBody(body);

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
  });

  app.post<{ Body: RunStartBody }>("/api/ai/runs", async (request) => {
    const body = request.body;
    validateAiChatBody(body);
    const run = runProvider.createRun({
      pluginId: body.pluginId,
      sessionId: body.sessionId,
      traceId: request.id
    });
    void executeRun({
      runProvider,
      runId: run.runId,
      pluginRuntime,
      body,
      traceId: request.id
    });
    return ok(
      {
        runId: run.runId,
        traceId: request.id,
        status: run.status
      },
      request.id
    );
  });

  app.get<{ Params: RunStreamParams; Querystring: RunStreamQuery }>(
    "/api/ai/runs/:runId/stream",
    async (request, reply) => {
      const run = runProvider.getRun(request.params.runId);
      if (!run) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "run not found", 404);
      }
      const lastSeq = request.query.lastSeq ? Number(request.query.lastSeq) : 0;
      if (request.query.lastSeq && !Number.isFinite(lastSeq)) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "lastSeq must be a number", 400);
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
      const subscribed = runProvider.subscribe(run.runId, res, lastSeq);
      if (!subscribed) {
        res.end();
        return;
      }
      request.raw.on("close", () => {
        runProvider.unsubscribe(run.runId, res);
      });
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        res.end();
      }
    }
  );

  app.post<{ Params: RunStreamParams }>("/api/ai/runs/:runId/cancel", async (request) => {
    const okCancel = runProvider.cancel(request.params.runId);
    if (!okCancel) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "run not found", 404);
    }
    return ok({ runId: request.params.runId, cancelled: true }, request.id);
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
