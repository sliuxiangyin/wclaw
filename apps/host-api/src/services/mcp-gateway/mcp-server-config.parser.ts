import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import type { McpServerStoredConfig } from "../../core/mcp-server.types.js";

const ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export class McpServerConfigParser {
  parse(body: unknown): McpServerStoredConfig {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "mcp server config must be a JSON object", 400);
    }
    const o = body as Record<string, unknown>;
    const id = o.id;
    const transport = o.transport;
    const enabled = o.enabled;

    if (typeof id !== "string" || !ID_RE.test(id) || id.length > 64) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "id must be kebab-case (lowercase letters, digits, hyphen), max 64 chars",
        400
      );
    }
    if (transport !== "stdio" && transport !== "http") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "transport must be 'stdio' or 'http'", 400);
    }
    if (typeof enabled !== "boolean") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "enabled must be a boolean", 400);
    }

    const stdio = this.parseStdio(o.stdio, transport === "stdio");
    const http = this.parseHttp(o.http, transport === "http");

    const displayName = o.displayName;
    const notes = o.notes;
    if (displayName !== undefined && typeof displayName !== "string") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "displayName must be a string", 400);
    }
    if (notes !== undefined && typeof notes !== "string") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "notes must be a string", 400);
    }

    return {
      id,
      displayName: typeof displayName === "string" ? displayName : undefined,
      enabled,
      transport,
      notes: typeof notes === "string" ? notes : undefined,
      stdio,
      http
    };
  }

  private parseStdio(raw: unknown, required: boolean): McpServerStoredConfig["stdio"] {
    if (raw === null || raw === undefined) {
      if (required) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio block is required for transport stdio", 400);
      }
      return null;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio must be an object", 400);
    }
    const s = raw as Record<string, unknown>;
    const command = s.command;
    if (typeof command !== "string" || command.length < 1 || command.length > 2048) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio.command must be a non-empty string", 400);
    }
    const args = s.args;
    if (args !== undefined) {
      if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio.args must be an array of strings", 400);
      }
    }
    const cwd = s.cwd;
    if (cwd !== undefined && cwd !== null && typeof cwd !== "string") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio.cwd must be a string or null", 400);
    }
    const env = s.env;
    if (env !== undefined && (typeof env !== "object" || env === null || Array.isArray(env))) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio.env must be an object", 400);
    }
    const envFlat = env as Record<string, unknown> | undefined;
    if (envFlat) {
      for (const [, v] of Object.entries(envFlat)) {
        if (typeof v !== "string") {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "stdio.env values must be strings", 400);
        }
      }
    }
    return {
      command,
      args: args as string[] | undefined,
      cwd: cwd === undefined ? undefined : (cwd as string | null),
      env: envFlat as Record<string, string> | undefined
    };
  }

  private parseHttp(raw: unknown, required: boolean): McpServerStoredConfig["http"] {
    if (raw === null || raw === undefined) {
      if (required) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http block is required for transport http", 400);
      }
      return null;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http must be an object", 400);
    }
    const h = raw as Record<string, unknown>;
    const url = h.url;
    if (typeof url !== "string" || url.length < 1 || url.length > 4096) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http.url must be a non-empty string", 400);
    }
    try {
      new URL(url);
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http.url must be an absolute URL", 400);
    }
    const headers = h.headers;
    if (
      headers !== undefined &&
      (typeof headers !== "object" || headers === null || Array.isArray(headers))
    ) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http.headers must be an object", 400);
    }
    const headersFlat = headers as Record<string, unknown> | undefined;
    if (headersFlat) {
      for (const [, v] of Object.entries(headersFlat)) {
        if (typeof v !== "string") {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http.headers values must be strings", 400);
        }
      }
    }
    const sessionId = h.sessionId;
    if (sessionId !== undefined && typeof sessionId !== "string") {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "http.sessionId must be a string", 400);
    }
    return {
      url,
      headers: headersFlat as Record<string, string> | undefined,
      sessionId: typeof sessionId === "string" ? sessionId : undefined
    };
  }
}
