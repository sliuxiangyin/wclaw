import {
  appendChatMessage,
  deleteAllChatMessagesForSession,
  listChatMessages,
  listPluginSessions
} from "../../repositories/plugin-chat.repository.js";
import { getPluginConfig } from "../../repositories/plugin-config.repository.js";
import type { PluginRuntimeExtension, PluginTurnHandleResult } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";
import { resolveSessionPersistDecision } from "../ai-chat/session-persistence-policy.service.js";
import type { PluginChatPersistRow } from "@wclaw/plugin-sdk";

type SendChatInput = {
  pluginRuntime: PluginRuntimePort;
  pluginId: string;
  sessionId: string;
  message: string;
  manifest: PluginManifest;
  stream?: {
    onTextDelta?: (delta: string) => void;
    onPluginActivity?: (payload: { phase: string; data?: Record<string, unknown> }) => void;
  };
  /**
   * 为 true 时不写入本条 user / 本轮 assistant reply（由 `orchestrateChat` 统一落库）；
   * 仍会处理插件返回的 `persist[]`。独立入口 `POST /api/plugins/:id/chat` 须为 false。
   */
  delegatedPersistence?: boolean;
};

export async function callExecuteTurn(input: SendChatInput) {
  const { pluginRuntime, pluginId, sessionId, message, manifest, stream, delegatedPersistence } = input;
  const shouldPersist = await resolveSessionPersistDecision(pluginRuntime, pluginId);
  if (!delegatedPersistence && shouldPersist(sessionId)) {
    appendChatMessage(pluginId, sessionId, "user", message);
  }

  const config = getPluginConfig(pluginId);
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  let reply: string;
  let continueFlow = false;

  // 运行时存在 executeTurn 时，统一走插件实例方法（保留 this 绑定）。
  // ai-chat-runtime-default 会在“default 会话”或“/命令”场景进入这里。
  if (typeof runtime?.executeTurn === "function") {
    const slashArgv = parseSlashArgv(message);
    const raw:PluginTurnHandleResult = await Promise.resolve(
      runtime.executeTurn({
        sessionId,
        message,
        config,
        ...(slashArgv ? { argv: slashArgv } : {}),
        emitAssistantDelta: stream?.onTextDelta,
        emitPluginActivity: stream?.onPluginActivity
      })
    );
    const parsed = normalizeHandleChatResult(pluginId, raw);
    reply = raw.text;
    continueFlow = parsed.continue;
    for (const row of parsed.persist) {
      if (shouldPersist(row.sessionId)) {
        appendChatMessage(pluginId, row.sessionId, row.role, row.content);
      }
    }
  } else {
    reply = buildDefaultReply(pluginId, message);
  }

  if (!delegatedPersistence && shouldPersist(sessionId)) {
    appendChatMessage(pluginId, sessionId, "assistant", reply);
  }
  return {
    sessionId,
    reply,
    continue: continueFlow,
    messages: listChatMessages(pluginId, sessionId)
  };
}

function turnHandleResultToString(raw: unknown): string {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as { text?: unknown }).text === "string"
  ) {
    return (raw as { text: string }).text;
  }
  return String(raw ?? "");
}

export async function runPluginCommand(
  pluginRuntime: PluginRuntimePort,
  pluginId: string,
  command: string,
  _manifest: PluginManifest,
  sessionIdForTurn: string = `${pluginId}:default`,
  stream?: {
    onTextDelta?: (delta: string) => void;
    onPluginActivity?: (payload: { phase: string; data?: Record<string, unknown> }) => void;
  }
) {
  const config = getPluginConfig(pluginId);
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  const [rawCmd = "", ...args] = parts;
  const cmd = normalizeCommandToken(rawCmd);
  if (typeof runtime?.executeTurn === "function") {
    const output = await Promise.resolve(
      runtime.executeTurn({
        sessionId: sessionIdForTurn,
        message: command,
        config,
        argv: { command: cmd, args },
        emitAssistantDelta: stream?.onTextDelta,
        emitPluginActivity: stream?.onPluginActivity
      })
    );
    return {
      pluginId,
      command,
      output: turnHandleResultToString(output)
    };
  }

  return {
    pluginId,
    command,
    output: `command accepted: ${command}`
  };
}

function parseSlashArgv(message: string): { command: string; args: string[] } | null {
  const trimmed = String(message || "").trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.startsWith("/command")) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [rawCmd = "", ...args] = parts;
  return { command: normalizeCommandToken(rawCmd), args };
}

function normalizeCommandToken(token: string): string {
  return String(token || "").trim().replace(/^\/+/, "").toLowerCase();
}

export async function clearPluginChatMessages(
  pluginRuntime: PluginRuntimePort,
  pluginId: string,
  sessionId: string,
  _manifest: PluginManifest
) {
  assertPluginChatSessionId(pluginId, sessionId);
  const config = getPluginConfig(pluginId);
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (runtime?.clearSession) {
    await Promise.resolve(runtime.clearSession({ sessionId, config }));
  }
  const deleted = deleteAllChatMessagesForSession(pluginId, sessionId);
  return { pluginId, sessionId, deleted };
}

export async function getPluginSessions(
  pluginRuntime: PluginRuntimePort,
  pluginId: string,
  defaultSessionId: string,
  _manifest: PluginManifest
) {
  const sessions = listPluginSessions(pluginId);
  const empty = sessions.length === 0;
  let rows: Array<{ sessionId: string; updatedAt: string; title?: string }> = empty
    ? [{ sessionId: defaultSessionId, updatedAt: new Date().toISOString() }]
    : sessions.map((s) => ({ sessionId: s.sessionId, updatedAt: s.updatedAt }));

  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (runtime?.decorateSessions) {
    rows = await Promise.resolve(runtime.decorateSessions());
  }

  return rows.map((s) => ({
    sessionId: s.sessionId,
    title: s.title ?? (empty && s.sessionId === defaultSessionId ? "默认会话" : s.sessionId),
    updatedAt: s.updatedAt
  }));
}

function buildDefaultReply(pluginId: string, message: string): string {
  return `[${pluginId}] 已收到222：${message}`;
}

function sessionIdBelongsToPlugin(pluginId: string, sid: string): boolean {
  return sid === `${pluginId}:default` || sid.startsWith(`${pluginId}:`);
}

function normalizeHandleChatResult(
  pluginId: string,
  raw: PluginTurnHandleResult
): { reply: string; continue: boolean; persist: PluginChatPersistRow[] } {
  return {
    reply: raw.text.length > 0 ? raw.text : "(empty plugin reply)",
    // 新约定：默认短路（continue=false），仅显式传 true 才继续后续流程。
    continue: raw.continue === true,
    persist: normalizePersistRows(pluginId, raw.persist)
  };
}

function normalizePersistRows(pluginId: string, rows:PluginChatPersistRow[] | undefined): PluginChatPersistRow[] {
  if (!Array.isArray(rows)) return [];
  const persist: PluginChatPersistRow[] = [];
  for (const item of rows) {
    const sid = item.sessionId;
    const role = item.role;
    const content = item.content;
    if (!sid || !content.trim()) continue;
    if (!sessionIdBelongsToPlugin(pluginId, sid)) continue;
    persist.push({ sessionId: sid, role, content });
  }
  return persist;
}
