import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import type { UIMessage } from "ai";

export function toAiChatErrorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: ERROR_CODES.INTERNAL_ERROR, message: error.message };
  }
  return { code: ERROR_CODES.INTERNAL_ERROR, message: "internal server error" };
}

export type AiChatBody = {
  pluginId?: string;
  sessionId?: string;
  messages: UIMessage[];
  system?: string;
  model?: string;
};

export function validateAiChatBody(body: AiChatBody, headers?: { pluginId?: unknown; sessionId?: unknown }) {
  const pluginId = typeof body?.pluginId === "string" ? body.pluginId : headers?.pluginId;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : headers?.sessionId;
  if (!pluginId || typeof pluginId !== "string") {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "pluginId is required", 400);
  }
  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "sessionId is required", 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "messages is required", 400);
  }
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "each message must be an object", 400);
    }
    if (typeof msg.id !== "string" || typeof msg.role !== "string") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "message.id and message.role are required", 400);
    }
    if (!Array.isArray(msg.parts)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "message.parts is required", 400);
    }
  }
}
