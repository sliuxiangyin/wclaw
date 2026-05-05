import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { listPlugins, plugin as loadPlugin } from "../services/plugin-catalog/plugin-catalog.service.js";

type Params = { pluginId: string };

export async function registerPluginsRoutes(app: FastifyInstance) {
  app.get("/api/plugins", async (request) => {
    const result = await listPlugins();
    return ok(result, request.id);
  });

  app.get<{ Params: Params }>("/api/plugins/:pluginId", async (request) => {
    const item = await loadPlugin(request.params.pluginId);
    if (!item) {
      throw new AppError(ERROR_CODES.PLUGIN_NOT_FOUND, "plugin not found", 404);
    }
    return ok(item, request.id);
  });
}
