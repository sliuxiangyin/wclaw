import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { getLlmConfig, saveLlmConfig } from "../repositories/llm-config.repository.js";

export async function registerLlmConfigRoutes(app: FastifyInstance) {
  app.get("/api/llm/config", async (request) => {
    const config = getLlmConfig();
    return ok({ scope: "global", config }, request.id);
  });

  app.put<{ Body: Record<string, unknown> }>("/api/llm/config", async (request) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm config body must be an object", 400);
    }
    saveLlmConfig(request.body);
    return ok({ scope: "global", config: request.body }, request.id);
  });
}
