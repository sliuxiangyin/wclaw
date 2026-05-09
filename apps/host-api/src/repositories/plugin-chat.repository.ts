import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { db } from "../core/db.js";

type MessageRow = {
  id: number;
  plugin_id: string;
  session_id: string;
  trace_id: string | null;
  message_id: string;
  role: string;
  content: string;
  ui_message_json: string;
  source_type: "runtime" | "plugin";
  source_plugin_id: string | null;
  llm_eligible: number;
  context_summary: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  session_id: string;
  updated_at: string;
};

export type AppendChatMessageOptions = {
  traceId?: string | null;
  sourceType?: "runtime" | "plugin";
  sourcePluginId?: string | null;
  llmEligible?: boolean;
  contextSummary?: string | null;
};

const insertStmt = db.prepare(`
  INSERT INTO plugin_chat_ui_messages (
    plugin_id, session_id, message_id, trace_id, role, ui_message_json, content_plain,
    source_type, source_plugin_id, llm_eligible, context_summary, created_at, updated_at
  )
  VALUES (
    @plugin_id, @session_id, @message_id, @trace_id, @role, @ui_message_json, @content_plain,
    @source_type, @source_plugin_id, @llm_eligible, @context_summary, @created_at, @updated_at
  )
`);

const upsertStmt = db.prepare(`
  INSERT INTO plugin_chat_ui_messages (
    plugin_id, session_id, message_id, trace_id, role, ui_message_json, content_plain,
    source_type, source_plugin_id, llm_eligible, context_summary, created_at, updated_at
  )
  VALUES (
    @plugin_id, @session_id, @message_id, @trace_id, @role, @ui_message_json, @content_plain,
    @source_type, @source_plugin_id, @llm_eligible, @context_summary, @created_at, @updated_at
  )
  ON CONFLICT(plugin_id, session_id, message_id) DO UPDATE SET
    trace_id = excluded.trace_id,
    role = excluded.role,
    ui_message_json = excluded.ui_message_json,
    content_plain = excluded.content_plain,
    source_type = excluded.source_type,
    source_plugin_id = excluded.source_plugin_id,
    llm_eligible = excluded.llm_eligible,
    context_summary = excluded.context_summary,
    updated_at = excluded.updated_at
`);

const listStmt = db.prepare(`
  SELECT id, plugin_id, session_id, message_id, trace_id, role, content_plain AS content, ui_message_json,
    source_type, source_plugin_id, llm_eligible, context_summary, created_at, updated_at
  FROM plugin_chat_ui_messages
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY id ASC
  LIMIT 100
`);

const listSessionsStmt = db.prepare(`
  SELECT session_id, MAX(updated_at) AS updated_at
  FROM plugin_chat_ui_messages
  WHERE plugin_id = ?
  GROUP BY session_id
  ORDER BY updated_at DESC
`);

const listTailStmt = db.prepare(`
  SELECT id, plugin_id, session_id, message_id, trace_id, role, content_plain AS content, ui_message_json,
    source_type, source_plugin_id, llm_eligible, context_summary, created_at, updated_at
  FROM plugin_chat_ui_messages
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

function textFromUiMessage(message: UIMessage): string {
  const lines: string[] = [];
  for (const raw of message.parts ?? []) {
    const part = raw as Record<string, unknown>;
    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

function textMessage(id: string, role: "user" | "assistant", content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text: content }]
  };
}

export function appendChatMessage(
  pluginId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  options?: AppendChatMessageOptions
) {
  const now = new Date().toISOString();
  const message = textMessage(`${role}:${randomUUID()}`, role, content);
  const r = insertStmt.run({
    plugin_id: pluginId,
    session_id: sessionId,
    message_id: message.id,
    trace_id: options?.traceId ?? null,
    role,
    ui_message_json: JSON.stringify(message),
    content_plain: content,
    source_type: options?.sourceType ?? "runtime",
    source_plugin_id: options?.sourcePluginId ?? null,
    llm_eligible: options?.llmEligible === false ? 0 : 1,
    context_summary: options?.contextSummary ?? null,
    created_at: now,
    updated_at: now
  });
  return Number(r.lastInsertRowid);
}

export function upsertUiMessage(input: {
  pluginId: string;
  sessionId: string;
  message: UIMessage;
  traceId?: string | null;
  sourceType?: "runtime" | "plugin";
  sourcePluginId?: string | null;
  llmEligible?: boolean;
  contextSummary?: string | null;
}) {
  const now = new Date().toISOString();
  const content = textFromUiMessage(input.message);
  const role = input.message.role === "assistant" ? "assistant" : "user";
  upsertStmt.run({
    plugin_id: input.pluginId,
    session_id: input.sessionId,
    message_id: input.message.id,
    trace_id: input.traceId ?? null,
    role,
    ui_message_json: JSON.stringify(input.message),
    content_plain: content,
    source_type: input.sourceType ?? "runtime",
    source_plugin_id: input.sourcePluginId ?? null,
    llm_eligible: input.llmEligible === false ? 0 : 1,
    context_summary: input.contextSummary ?? null,
    created_at: now,
    updated_at: now
  });
}

export function listChatMessages(pluginId: string, sessionId: string) {
  return listStmt.all(pluginId, sessionId) as MessageRow[];
}

/** 按 id 倒序取最近若干条（调用方如需时间正序可自行 reverse） */
export function listChatMessagesTail(pluginId: string, sessionId: string, limit: number) {
  return listTailStmt.all(pluginId, sessionId, limit) as MessageRow[];
}

export function listUiMessages(pluginId: string, sessionId: string, limit = 100): UIMessage[] {
  const rows = listChatMessagesTail(pluginId, sessionId, limit).reverse();
  const messages: UIMessage[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.ui_message_json) as UIMessage;
      if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.parts)) {
        messages.push(parsed);
      }
    } catch {
      // 忽略损坏行，避免单条历史破坏整个会话加载。
    }
  }
  return messages;
}

export function listPluginSessions(pluginId: string): Array<{ sessionId: string; updatedAt: string }> {
  const rows = listSessionsStmt.all(pluginId) as SessionRow[];
  return rows.map((r) => ({ sessionId: r.session_id, updatedAt: r.updated_at }));
}

const deleteSessionMessagesStmt = db.prepare(
  `DELETE FROM plugin_chat_ui_messages WHERE plugin_id = ? AND session_id = ?`
);

/** 删除某插件某会话下全部聊天消息（宿主库内）；返回删除行数 */
export function deleteAllChatMessagesForSession(pluginId: string, sessionId: string): number {
  const r = deleteSessionMessagesStmt.run(pluginId, sessionId);
  return typeof r.changes === "number" ? r.changes : 0;
}
