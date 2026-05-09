import type { FastifyInstance } from "fastify";
import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import type { NotificationStreamInput } from "../core/notification.types.js";
import type { AiRunProvider } from "../providers/ai-run-provider/index.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { listChatEvents } from "../repositories/chat-event.repository.js";
import { handleAiChatStream } from "../controllers/ai-chat-stream.controller.js";
import { validateAiChatBody, type AiChatBody } from "./ai-chat-validation.js";

type AiChatEventsQuery = {
  pluginId?: string;
  sessionId?: string;
  type?: string;
  limit?: string;
  offset?: string;
};

type AiChatCancelBody = {
  pluginId?: string;
  sessionId?: string;
};

type PublishNotificationStream = (input: NotificationStreamInput) => void;

export async function registerAiChatRoutes(
  app: FastifyInstance,
  pluginRuntime: PluginRuntimePort,
  aiRunProvider: AiRunProvider,
  publishNotification?: PublishNotificationStream
) {
  app.post<{ Body: AiChatBody }>("/api/ai/chat", async (request, reply) => {
    validateAiChatBody(request.body, {
      pluginId: request.headers["x-wclaw-plugin-id"],
      sessionId: request.headers["x-wclaw-session-id"]
    });
    await handleAiChatStream(request, reply, pluginRuntime, aiRunProvider, publishNotification);
  });

  app.post<{ Body: AiChatCancelBody }>("/api/ai/chat/cancel", async (request) => {
    const pluginId = request.body?.pluginId ?? request.headers["x-wclaw-plugin-id"];
    const sessionId = request.body?.sessionId ?? request.headers["x-wclaw-session-id"];
    if (Array.isArray(pluginId) || Array.isArray(sessionId) || !pluginId || !sessionId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "pluginId and sessionId are required", 400);
    }
    const cancelled = aiRunProvider.cancelSession(pluginId, sessionId);
    return ok({ pluginId, sessionId, cancelled }, request.id);
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
