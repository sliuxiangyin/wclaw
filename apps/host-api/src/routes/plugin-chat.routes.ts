import type { FastifyInstance } from "fastify";
import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { plugin as catalogPlugin } from "../services/plugin-catalog/plugin-catalog.service.js";
import type { McpGatewayService } from "../services/mcp-gateway/mcp-gateway.service.js";
import {
  getChatSessionState,
  saveChatSessionState,
  type McpToolForbidden
} from "../repositories/chat-session.repository.js";
import {
  clearPluginChatMessages,
  getPluginSessions,
  runPluginCommand,
  callExecuteTurn
} from "../services/plugin-chat/plugin-chat.service.js";
import { getPluginChatHistoryTimeline } from "../services/plugin-chat/plugin-chat-history.service.js";
import {
  assertForbiddenInsideAllowedCatalog,
  buildPluginMcpAllowedCatalog,
  parseMcpToolForbiddenBody,
  sanitizeForbiddenByAllowedCatalog
} from "../controllers/plugin-chat-mcp.controller.js";

type Params = { pluginId: string };
type SwitchParams = { pluginId: string; sessionId: string };
type SessionMessagesParams = { pluginId: string; sessionId: string };
type SessionMessagesQuery = { limit?: string };
type ChatBody = { sessionId?: string; message: string };
type CommandBody = { command: string };
type SwitchSessionBody = { sessionId: string };
type McpToolForbiddenBody = McpToolForbidden;

export async function registerPluginChatRoutes(
  app: FastifyInstance,
  pluginRuntime: PluginRuntimePort,
  mcpGateway: McpGatewayService
) {
  app.get<{ Params: Params }>("/api/plugins/:pluginId/sessions", async (request) => {
    const plugin = await catalogPlugin(request.params.pluginId);
    if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
      throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
    }
    const sessions = await getPluginSessions(pluginRuntime, request.params.pluginId, plugin.manifest);
    return ok({ pluginId: request.params.pluginId, sessions }, request.id);
  });

  app.get<{ Params: SessionMessagesParams; Querystring: SessionMessagesQuery }>(
    "/api/plugins/:pluginId/sessions/:sessionId/messages",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      const limitRaw = request.query.limit;
      const limitNum = limitRaw !== undefined && limitRaw !== "" ? Number(limitRaw) : undefined;
      if (limitRaw !== undefined && limitRaw !== "" && !Number.isFinite(limitNum)) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "limit must be a number", 400);
      }
      const data = getPluginChatHistoryTimeline({
        pluginId: request.params.pluginId,
        sessionId: request.params.sessionId,
        limit: limitNum
      });
      return ok(data, request.id);
    }
  );

  app.get<{ Params: SessionMessagesParams }>(
    "/api/plugins/:pluginId/sessions/:sessionId/mcp-allowed-catalog",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      const allowedCatalog = buildPluginMcpAllowedCatalog(plugin.manifest, mcpGateway);
      const state = getChatSessionState(request.params.pluginId, request.params.sessionId);
      const forbidden = sanitizeForbiddenByAllowedCatalog(state.mcpToolForbidden, allowedCatalog);
      return ok(
        {
          pluginId: request.params.pluginId,
          sessionId: request.params.sessionId,
          mcpAllowedCatalog: allowedCatalog,
          mcpToolForbidden: forbidden
        },
        request.id
      );
    }
  );

  app.get<{ Params: SessionMessagesParams }>(
    "/api/plugins/:pluginId/sessions/:sessionId/mcp-tool-forbidden",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      const allowedCatalog = buildPluginMcpAllowedCatalog(plugin.manifest, mcpGateway);
      const state = getChatSessionState(request.params.pluginId, request.params.sessionId);
      return ok(
        {
          pluginId: request.params.pluginId,
          sessionId: request.params.sessionId,
          mcpToolForbidden: sanitizeForbiddenByAllowedCatalog(state.mcpToolForbidden, allowedCatalog)
        },
        request.id
      );
    }
  );

  app.put<{ Params: SessionMessagesParams; Body: McpToolForbiddenBody }>(
    "/api/plugins/:pluginId/sessions/:sessionId/mcp-tool-forbidden",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      const next = parseMcpToolForbiddenBody(request.body);
      const allowedCatalog = buildPluginMcpAllowedCatalog(plugin.manifest, mcpGateway);
      assertForbiddenInsideAllowedCatalog(next, allowedCatalog);
      const current = getChatSessionState(request.params.pluginId, request.params.sessionId);
      const sanitized = sanitizeForbiddenByAllowedCatalog(next, allowedCatalog);
      saveChatSessionState({
        pluginId: current.pluginId,
        sessionId: current.sessionId,
        mode: current.mode,
        isolatedPluginId: current.isolatedPluginId,
        mcpToolForbidden: sanitized
      });
      return ok(
        {
          pluginId: request.params.pluginId,
          sessionId: request.params.sessionId,
          mcpToolForbidden: sanitized
        },
        request.id
      );
    }
  );

  app.delete<{ Params: SessionMessagesParams }>(
    "/api/plugins/:pluginId/sessions/:sessionId/messages",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      const data = await clearPluginChatMessages(
        pluginRuntime,
        request.params.pluginId,
        request.params.sessionId,
        plugin.manifest
      );
      return ok(data, request.id);
    }
  );

  app.post<{ Params: SwitchParams; Body: SwitchSessionBody }>(
    "/api/plugins/:pluginId/sessions/:sessionId/switch",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      return ok({ pluginId: request.params.pluginId, sessionId: request.params.sessionId }, request.id);
    }
  );

  app.post<{ Params: Params; Body: ChatBody }>("/api/plugins/:pluginId/chat", async (request) => {
    const plugin = await catalogPlugin(request.params.pluginId);
    if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
      throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
    }

    if (!request.body?.message || typeof request.body.message !== "string") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "message is required", 400);
    }

    const canChat = plugin.manifest.kind === "runtime_plugin";
    if (!canChat) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "plugin does not support chat", 400);
    }

    const sessionId = request.body.sessionId || `${request.params.pluginId}:default`;
    const result = await callExecuteTurn({
      pluginRuntime,
      pluginId: request.params.pluginId,
      sessionId,
      message: request.body.message,
      manifest: plugin.manifest
    });

    return ok(result, request.id);
  });

  app.post<{ Params: Params; Body: CommandBody }>(
    "/api/plugins/:pluginId/command",
    async (request) => {
      const plugin = await catalogPlugin(request.params.pluginId);
      if (!plugin || plugin.status !== "valid" || !plugin.manifest) {
        throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
      }
      if (!request.body?.command || typeof request.body.command !== "string") {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "command is required", 400);
      }
      const result = await runPluginCommand(
        pluginRuntime,
        request.params.pluginId,
        request.body.command,
        plugin.manifest,
        `${request.params.pluginId}:default`
      );
      return ok(result, request.id);
    }
  );
}
