import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";

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
  pluginId: string;
  sessionId: string;
  messages: Array<{
    id: string;
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  model?: string;
};

export function validateAiChatBody(body: AiChatBody) {
  if (!body?.pluginId || typeof body.pluginId !== "string") {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "pluginId is required", 400);
  }
  if (!body?.sessionId || typeof body.sessionId !== "string") {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "sessionId is required", 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "messages is required", 400);
  }
  for (const msg of body.messages) {
    if (!msg || typeof msg !== "object") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "each message must be an object", 400);
    }
    if (typeof msg.role !== "string" || typeof msg.content !== "string") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "message.role and message.content are required", 400);
    }
  }
}
