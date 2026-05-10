import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import {
  createLlmProfile,
  deleteLlmProfile,
  findLlmProfile,
  getActiveLlmScope,
  getLlmConfig,
  listLlmProfiles,
  saveLlmConfig,
  setActiveLlmScope
} from "../repositories/llm-config.repository.js";

export async function registerLlmConfigRoutes(app: FastifyInstance) {
  app.get("/api/llm/config", async (request) => {
    const scope = getActiveLlmScope();
    const config = getLlmConfig(scope);
    return ok({ scope, config }, request.id);
  });

  app.put<{ Body: Record<string, unknown> }>("/api/llm/config", async (request) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm config body must be an object", 400);
    }
    const scope = getActiveLlmScope();
    saveLlmConfig(request.body, scope);
    return ok({ scope, config: request.body }, request.id);
  });

  app.get("/api/llm/profiles", async (request) => {
    const profiles = listLlmProfiles();
    return ok({ profiles, activeScope: getActiveLlmScope() }, request.id);
  });

  app.post<{ Body: Record<string, unknown> | undefined }>("/api/llm/profiles", async (request) => {
    const partial =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : undefined;
    const created = createLlmProfile(partial);
    return ok(created, request.id);
  });

  app.get<{ Params: { scope: string } }>("/api/llm/profiles/:scope", async (request) => {
    const row = findLlmProfile(request.params.scope);
    if (!row) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm profile not found", 404);
    }
    return ok(row, request.id);
  });

  app.put<{ Params: { scope: string }; Body: Record<string, unknown> }>(
    "/api/llm/profiles/:scope",
    async (request) => {
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm config body must be an object", 400);
      }
      const row = findLlmProfile(request.params.scope);
      if (!row) {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm profile not found", 404);
      }
      saveLlmConfig(request.body, request.params.scope);
      return ok({ scope: request.params.scope, config: request.body }, request.id);
    }
  );

  app.post<{ Params: { scope: string } }>("/api/llm/profiles/:scope/activate", async (request) => {
    try {
      setActiveLlmScope(request.params.scope);
    } catch {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm profile not found", 404);
    }
    return ok({ activeScope: getActiveLlmScope() }, request.id);
  });

  app.delete<{ Params: { scope: string } }>("/api/llm/profiles/:scope", async (request) => {
    const row = findLlmProfile(request.params.scope);
    if (!row) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "llm profile not found", 404);
    }
    deleteLlmProfile(request.params.scope);
    return ok({ ok: true, activeScope: getActiveLlmScope() }, request.id);
  });
}
