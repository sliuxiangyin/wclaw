import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";

export function assertPluginChatSessionId(pluginId: string, sessionId: string): void {
  if (sessionId !== `${pluginId}:default` && !sessionId.startsWith(`${pluginId}:`)) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "sessionId does not belong to plugin", 400);
  }
}
