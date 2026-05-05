import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import type { McpGatewayService } from "../services/mcp-gateway/mcp-gateway.service.js";

export async function registerMcpRoutes(app: FastifyInstance, mcpGateway: McpGatewayService) {
  app.get("/api/mcp/servers", async (request) => {
    const servers = mcpGateway.listMcpServerSummaries();
    return ok({ servers }, request.id);
  });

  app.get<{ Params: { id: string } }>("/api/mcp/servers/:id", async (request) => {
    const detail = mcpGateway.getMcpServerDetail(request.params.id);
    return ok(detail, request.id);
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/mcp/servers/:id", async (request) => {
    const saved = mcpGateway.putMcpServer(request.body, request.params.id);
    const detail = mcpGateway.getMcpServerDetail(saved.id);
    return ok(detail, request.id);
  });

  app.delete<{ Params: { id: string } }>("/api/mcp/servers/:id", async (request) => {
    mcpGateway.removeMcpServer(request.params.id);
    return ok({ deleted: true, id: request.params.id }, request.id);
  });

  app.post<{ Params: { id: string } }>("/api/mcp/servers/:id/probe", async (request) => {
    const status = await mcpGateway.probeMcpServer(request.params.id);
    return ok({ id: request.params.id, status }, request.id);
  });

  app.get("/api/mcp/catalog", async (request) => {
    const catalog = mcpGateway.buildCatalog();
    return ok(catalog, request.id);
  });

  app.get<{ Querystring: { toolId?: string } }>("/api/mcp/tools/schema", async (request) => {
    const toolId = request.query.toolId?.trim();
    if (!toolId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "query toolId is required", 400);
    }
    const { serverId, toolName } = mcpGateway.splitQualifiedToolId(toolId);
    const schema = mcpGateway.getToolSchemaFromSnapshot(serverId, toolName);
    return ok({ toolId, inputSchema: schema }, request.id);
  });

  app.post<{
    Body: { toolId?: string; arguments?: unknown };
  }>("/api/mcp/validate", async (request) => {
    const toolId = request.body.toolId?.trim();
    if (!toolId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "toolId is required", 400);
    }
    const args = mcpGateway.validateToolArguments(toolId, request.body.arguments);
    const { serverId, toolName } = mcpGateway.splitQualifiedToolId(toolId);
    const schema = mcpGateway.getToolSchemaFromSnapshot(serverId, toolName);
    return ok({ toolId, arguments: args, inputSchema: schema, validation: "none" as const }, request.id);
  });

  app.post<{
    Body: {
      toolId?: string;
      arguments?: unknown;
      traceId?: string | null;
      pluginId?: string | null;
      sessionId?: string | null;
    };
  }>("/api/mcp/invoke", async (request) => {
    const toolId = request.body.toolId?.trim();
    if (!toolId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "toolId is required", 400);
    }
    const args = mcpGateway.validateToolArguments(toolId, request.body.arguments);
    const traceId =
      typeof request.body.traceId === "string" && request.body.traceId.trim()
        ? request.body.traceId.trim()
        : request.id;
    void request.body.pluginId;
    void request.body.sessionId;
    const result = await mcpGateway.invokeTool({ toolId, arguments: args, traceId });
    app.log.info(
      {
        traceId,
        pluginId: request.body.pluginId ?? null,
        sessionId: request.body.sessionId ?? null,
        toolId
      },
      "mcp.invoke"
    );
    return ok({ toolId, result }, request.id);
  });
}
