import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { getPluginConfig, savePluginConfig } from "../repositories/plugin-config.repository.js";

type Params = { pluginId: string };
type ValidateBody = { config: Record<string, unknown> };

export async function registerPluginConfigRoutes(app: FastifyInstance) {
  app.get<{ Params: Params }>("/api/plugins/:pluginId/config", async (request) => {
    const config = getPluginConfig(request.params.pluginId);
    return ok({ pluginId: request.params.pluginId, config }, request.id);
  });

  app.put<{ Params: Params; Body: Record<string, unknown> }>(
    "/api/plugins/:pluginId/config",
    async (request) => {
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "config body must be an object", 400);
      }

      savePluginConfig(request.params.pluginId, request.body);
      return ok({ pluginId: request.params.pluginId, config: request.body }, request.id);
    }
  );

  app.post<{ Params: Params; Body: ValidateBody }>(
    "/api/plugins/:pluginId/config/validate",
    async (request) => {
      const payload = request.body?.config;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "config must be an object", 400);
      }

      return ok(
        {
          pluginId: request.params.pluginId,
          valid: true,
          errors: []
        },
        request.id
      );
    }
  );
}
