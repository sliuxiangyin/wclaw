import type { ExternalUserTurnInput, ExternalUserTurnResult } from "@wclaw/plugin-sdk";
import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { listChatMessagesTail } from "../../repositories/plugin-chat.repository.js";
import { assertPluginChatSessionId } from "../plugin-chat/plugin-chat-session-guard.js";
import { orchestrateChat } from "../ai-chat/ai-chat.service.js";
import type { UiChatMessage } from "../ai-chat/ai-chat.types.js";

const CONTEXT_TAIL = 80;
const DEFAULT_SESSION_SUFFIX = ":default";

function rowsToUiMessages(
  rows: Array<{ id: number; role: string; content: string }>
): UiChatMessage[] {
  const chronological = [...rows].reverse();
  const out: UiChatMessage[] = [];
  for (const row of chronological) {
    const role = row.role === "assistant" ? "assistant" : "user";
    if (role !== "user" && role !== "assistant") continue;
    out.push({
      id: `db:${row.id}`,
      role,
      content: row.content,
      parts: [{ type: "text", text: row.content }]
    });
  }
  return out;
}

/**
 * 为单个 `runtime_plugin` 构造 `ingestExternalUserTurn`：每次调用从 DB 拉尾部上下文并追加本轮 user，再 `orchestrateChat`。
 * `getPluginRuntime` 在首帧注入前可能为 null，调用方应仅在调度/运行期调用。
 */
export type ChatSessionUpdatedNotify = (input: {
  pluginId: string;
  sessionId: string;
  source?: ExternalUserTurnInput["source"];
  metadata?: Record<string, unknown>;
}) => void;

export function createIngestExternalUserTurnForPlugin(options: {
  pluginId: string;
  getPluginRuntime: () => PluginRuntimePort;
  notifyChatSessionUpdated: ChatSessionUpdatedNotify;
}): (input: ExternalUserTurnInput) => Promise<ExternalUserTurnResult> {
  const { pluginId, getPluginRuntime, notifyChatSessionUpdated } = options;

  return async (input: ExternalUserTurnInput): Promise<ExternalUserTurnResult> => {
    const userText = String(input.userText ?? "").trim();
    if (userText.length === 0) {
      return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "userText is empty" };
    }

    try {
      assertPluginChatSessionId(pluginId, input.sessionId);
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: "invalid sessionId" };
    }

    if (input.sessionId === `${pluginId}${DEFAULT_SESSION_SUFFIX}`) {
      return {
        ok: false,
        code: ERROR_CODES.INVALID_REQUEST,
        message: "external ingest is not allowed on default session"
      };
    }

    const tail = listChatMessagesTail(pluginId, input.sessionId, CONTEXT_TAIL);
    const messages: UiChatMessage[] = rowsToUiMessages(tail);
    const extId = `ext:${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    messages.push({ id: extId, role: "user", content: userText, parts: [{ type: "text", text: userText }] });

    const traceId =
      input.traceId && input.traceId.length > 0 ? `external:${input.traceId}` : `external:${pluginId}`;

    try {
      const pluginRuntime = getPluginRuntime();
      const hostPlugin = await pluginRuntime.plugin(pluginId);
      if (!hostPlugin || hostPlugin.status !== "valid" || !hostPlugin.manifest) {
        return { ok: false, code: ERROR_CODES.PLUGIN_NOT_FOUND, message: "plugin not found" };
      }
      const result = await orchestrateChat({
        pluginRuntime,
        plugin: hostPlugin,
        pluginId,
        sessionId: input.sessionId,
        messages,
        model: input.model,
        traceId,
        reflowMetadata: input.metadata
      });

      try {
        notifyChatSessionUpdated({
          pluginId,
          sessionId: input.sessionId,
          source: input.source,
          metadata: input.metadata
        });
      } catch {
        // 通知失败不影响编排结果
      }

      return {
        ok: true,
        sessionId: input.sessionId,
        reply: result.reply,
        mode: result.mode
      };
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "plugin not found") {
        return { ok: false, code: ERROR_CODES.PLUGIN_NOT_FOUND, message: msg };
      }
      return { ok: false, code: ERROR_CODES.INTERNAL_ERROR, message: msg };
    }
  };
}
