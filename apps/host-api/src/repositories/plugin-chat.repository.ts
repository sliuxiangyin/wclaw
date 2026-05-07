import { db } from "../core/db.js";

type MessageRow = {
  id: number;
  plugin_id: string;
  session_id: string;
  trace_id: string | null;
  role: string;
  content: string;
  source_type: "runtime" | "plugin";
  source_plugin_id: string | null;
  llm_eligible: number;
  context_summary: string | null;
  created_at: string;
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
  INSERT INTO plugin_chat_messages (
    plugin_id, session_id, trace_id, role, content, source_type, source_plugin_id, llm_eligible, context_summary, created_at
  )
  VALUES (
    @plugin_id, @session_id, @trace_id, @role, @content, @source_type, @source_plugin_id, @llm_eligible, @context_summary, @created_at
  )
`);

const listStmt = db.prepare(`
  SELECT id, plugin_id, session_id, trace_id, role, content, source_type, source_plugin_id, llm_eligible, context_summary, created_at
  FROM plugin_chat_messages
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY id ASC
  LIMIT 100
`);

const listSessionsStmt = db.prepare(`
  SELECT session_id, MAX(created_at) AS updated_at
  FROM plugin_chat_messages
  WHERE plugin_id = ?
  GROUP BY session_id
  ORDER BY updated_at DESC
`);

const listTailStmt = db.prepare(`
  SELECT id, plugin_id, session_id, trace_id, role, content, source_type, source_plugin_id, llm_eligible, context_summary, created_at
  FROM plugin_chat_messages
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

export function appendChatMessage(
  pluginId: string,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  options?: AppendChatMessageOptions
) {
  const r = insertStmt.run({
    plugin_id: pluginId,
    session_id: sessionId,
    trace_id: options?.traceId ?? null,
    role,
    content,
    source_type: options?.sourceType ?? "runtime",
    source_plugin_id: options?.sourcePluginId ?? null,
    llm_eligible: options?.llmEligible === false ? 0 : 1,
    context_summary: options?.contextSummary ?? null,
    created_at: new Date().toISOString()
  });
  return Number(r.lastInsertRowid);
}

export function listChatMessages(pluginId: string, sessionId: string) {
  return listStmt.all(pluginId, sessionId) as MessageRow[];
}

/** 按 id 倒序取最近若干条（调用方如需时间正序可自行 reverse） */
export function listChatMessagesTail(pluginId: string, sessionId: string, limit: number) {
  return listTailStmt.all(pluginId, sessionId, limit) as MessageRow[];
}

export function listPluginSessions(pluginId: string): Array<{ sessionId: string; updatedAt: string }> {
  const rows = listSessionsStmt.all(pluginId) as SessionRow[];
  return rows.map((r) => ({ sessionId: r.session_id, updatedAt: r.updated_at }));
}

const deleteSessionMessagesStmt = db.prepare(
  `DELETE FROM plugin_chat_messages WHERE plugin_id = ? AND session_id = ?`
);

/** 删除某插件某会话下全部聊天消息（宿主库内）；返回删除行数 */
export function deleteAllChatMessagesForSession(pluginId: string, sessionId: string): number {
  const r = deleteSessionMessagesStmt.run(pluginId, sessionId);
  return typeof r.changes === "number" ? r.changes : 0;
}
