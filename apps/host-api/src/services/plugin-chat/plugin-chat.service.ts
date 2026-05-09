import {
  appendChatMessage,
  deleteAllChatMessagesForSession,
  listChatMessages
} from "../../repositories/plugin-chat.repository.js";
import { deleteChatEventsBySession } from "../../repositories/chat-event.repository.js";
import { deleteChatSessionState } from "../../repositories/chat-session.repository.js";
import { getPluginConfig } from "../../repositories/plugin-config.repository.js";
import type {
  PluginRuntimeExtension,
  PluginToolLikeStepPayload,
  PluginTurnHandleResult
} from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";
import { resolveSessionPersistDecision } from "../ai-chat/session-persistence-policy.service.js";
import type { PluginChatPersistRow } from "@wclaw/plugin-sdk";
import type { PluginSessionRow } from "@wclaw/plugin-sdk";

type SendChatInput = {
  pluginRuntime: PluginRuntimePort;
  pluginId: string;
  sessionId: string;
  message: string;
  manifest: PluginManifest;
  stream?: {
    onTextDelta?: (delta: string) => void;
    onToolLikeStep?: (step: PluginToolLikeStepPayload) => void;
  };
  /**
   * 为 true 时不写入本条 user / 本轮 assistant reply（由 `orchestrateChat` 统一落库）；
   * 仍会处理插件返回的 `persist[]`。独立入口 `POST /api/plugins/:id/chat` 须为 false。
   */
  delegatedPersistence?: boolean;
};

export async function callExecuteTurn(input: SendChatInput) {
  const { pluginRuntime, pluginId, sessionId, message, manifest, stream, delegatedPersistence } = input;
  const row = await pluginRuntime.plugin(pluginId);
  const shouldPersist = await resolveSessionPersistDecision(row);
  if (!delegatedPersistence && shouldPersist(sessionId)) {
    appendChatMessage(pluginId, sessionId, "user", message);
  }

  const config = getPluginConfig(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  let reply: string;
  let continueFlow = false;
  /** `continue===true` 时本轮 `text` 不写入最终 assistant 行（交由后续编排或仅作中间结果） */
  let skipFinalAssistantPersist = false;

  // 运行时存在 executeTurn 时，统一走插件实例方法（保留 this 绑定）。
  // ai-chat-runtime-default 会在“default 会话”或“/命令”场景进入这里。
  if (typeof runtime?.executeTurn === "function") {
    const slashArgv = parseSlashArgv(message);
    const raw = (await Promise.resolve(
      runtime.executeTurn({
        sessionId,
        message,
        config,
        ...(slashArgv ? { argv: slashArgv } : {}),
        emitAssistantDelta: stream?.onTextDelta,
        emitToolLikeStep: stream?.onToolLikeStep
      })
    )) as PluginTurnHandleResult;
    const parsed = normalizeHandleChatResult(pluginId, raw);
    reply = raw.text;
    continueFlow = parsed.continue;
    skipFinalAssistantPersist = parsed.continue;
    for (const row of parsed.persist) {
      if (shouldPersist(row.sessionId)) {
        appendChatMessage(pluginId, row.sessionId, row.role, row.content);
      }
    }
  } else {
    reply = buildDefaultReply(pluginId, message);
  }

  if (!delegatedPersistence && shouldPersist(sessionId) && !skipFinalAssistantPersist) {
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
    onToolLikeStep?: (step: PluginToolLikeStepPayload) => void;
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
        emitToolLikeStep: stream?.onToolLikeStep
      })
    );
    const parsed = parseExecuteTurnPayload(output);
    return {
      pluginId,
      command,
      output: parsed.text,
      continue: parsed.continue
    };
  }

  return {
    pluginId,
    command,
    output: `command accepted: ${command}`,
    continue: false
  };
}

function parseExecuteTurnPayload(raw: unknown): { text: string; continue: boolean } {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as PluginTurnHandleResult).text === "string"
  ) {
    const r = raw as PluginTurnHandleResult;
    return { text: r.text, continue: r.continue === true };
  }
  return { text: turnHandleResultToString(raw), continue: false };
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
  const deletedEvents = deleteChatEventsBySession(pluginId, sessionId);
  const deletedSessionState = deleteChatSessionState(pluginId, sessionId);
  return {
    pluginId,
    sessionId,
    deleted,
    deletedActivities: 0,
    deletedEvents,
    deletedSessionState
  };
}

export async function getPluginSessions(
  pluginRuntime: PluginRuntimePort,
  pluginId: string,
  _manifest: PluginManifest
) {
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (!runtime?.decorateSessions) return [];
  const rows = await Promise.resolve(runtime.decorateSessions());
  return normalizeSessionRows(rows);
}

function buildDefaultReply(pluginId: string, message: string): string {
  return `[${pluginId}] 已收到：${message}`;
}

function sessionIdBelongsToPlugin(pluginId: string, sid: string): boolean {
  return sid === `${pluginId}:default` || sid.startsWith(`${pluginId}:`);
}

/** 解析 `executeTurn` 返回值；`continue` 语义对全部 kind 与 `executeCommandPlugin` 路径一致（见 `docs/项目功能/插件/插件.md`）。 */
function normalizeHandleChatResult(
  pluginId: string,
  raw: PluginTurnHandleResult
): { reply: string; continue: boolean; persist: PluginChatPersistRow[] } {
  return {
    reply: raw.text.length > 0 ? raw.text : "(empty plugin reply)",
    // 仅显式 `true` 视为继续编排；与 `toTurnResult` 默认 `false` 对齐。
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

function normalizeSessionRows(rows: PluginSessionRow[] | undefined): PluginSessionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((s) => Boolean(s?.sessionId) && Boolean(s?.updatedAt));
}
