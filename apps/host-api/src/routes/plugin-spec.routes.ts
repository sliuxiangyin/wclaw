import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { validatePluginSpec } from "../core/validate-plugin-spec.js";

type Params = { pluginId: string };
type Body = { spec: unknown };

export async function registerPluginSpecRoutes(app: FastifyInstance) {
  app.post<{ Params: Params; Body: Body }>("/api/plugins/:pluginId/validate", async (request) => {
    if (!request.body || typeof request.body !== "object") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "request body is required", 400);
    }

    const result = validatePluginSpec(request.body.spec);
    if (!result.valid) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, result.errors.join("; "), 400);
    }

    return ok(
      {
        pluginId: request.params.pluginId,
        valid: true,
        errors: []
      },
      request.id
    );
  });
}
