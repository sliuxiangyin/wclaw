import { db } from "../core/db.js";

type ChatEventSource = "host" | "llm" | "plugin" | "tool";

const insertStmt = db.prepare(`
  INSERT INTO chat_events (trace_id, plugin_id, session_id, type, source, payload_json, created_at)
  VALUES (@trace_id, @plugin_id, @session_id, @type, @source, @payload_json, @created_at)
`);

const listStmt = db.prepare(`
  SELECT id, trace_id, plugin_id, session_id, type, source, payload_json, created_at
  FROM chat_events
  WHERE plugin_id = COALESCE(@plugin_id, plugin_id)
    AND session_id = COALESCE(@session_id, session_id)
    AND type = COALESCE(@type, type)
  ORDER BY id DESC
  LIMIT @limit OFFSET @offset
`);

const deleteBySessionStmt = db.prepare(
  `DELETE FROM chat_events WHERE plugin_id = ? AND session_id = ?`
);

export function appendChatEvent(input: {
  traceId?: string | null;
  pluginId: string;
  sessionId: string;
  type: string;
  source: ChatEventSource;
  payload?: Record<string, unknown>;
}) {
  insertStmt.run({
    trace_id: input.traceId ?? null,
    plugin_id: input.pluginId,
    session_id: input.sessionId,
    type: input.type,
    source: input.source,
    payload_json: JSON.stringify(input.payload ?? {}),
    created_at: new Date().toISOString()
  });
}

export function listChatEvents(input: {
  pluginId?: string;
  sessionId?: string;
  type?: string;
  limit?: number;
  offset?: number;
}) {
  const rows = listStmt.all({
    plugin_id: input.pluginId ?? null,
    session_id: input.sessionId ?? null,
    type: input.type ?? null,
    limit: normalizeLimit(input.limit),
    offset: normalizeOffset(input.offset)
  }) as Array<{
    id: number;
    trace_id: string | null;
    plugin_id: string;
    session_id: string;
    type: string;
    source: ChatEventSource;
    payload_json: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    traceId: r.trace_id,
    pluginId: r.plugin_id,
    sessionId: r.session_id,
    type: r.type,
    source: r.source,
    payload: safeParse(r.payload_json),
    createdAt: r.created_at
  }));
}

/** 删除某插件某会话下全部 chat_events；返回删除行数 */
export function deleteChatEventsBySession(pluginId: string, sessionId: string): number {
  const r = deleteBySessionStmt.run(pluginId, sessionId);
  return typeof r.changes === "number" ? r.changes : 0;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.min(Math.max(Math.trunc(limit as number), 1), 500);
}

function normalizeOffset(offset?: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset as number), 0);
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
