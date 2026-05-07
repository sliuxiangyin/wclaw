import { db } from "../core/db.js";

export type PluginChatActivityRow = {
  id: number;
  plugin_id: string;
  session_id: string;
  trace_id: string;
  seq: number;
  phase: string;
  payload_json: string;
  created_at: string;
};

const insertStmt = db.prepare(`
  INSERT INTO plugin_chat_activity (
    plugin_id, session_id, trace_id, seq, phase, payload_json, created_at
  )
  VALUES (
    @plugin_id, @session_id, @trace_id, @seq, @phase, @payload_json, @created_at
  )
`);

const nextSeqStmt = db.prepare(`
  SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
  FROM plugin_chat_activity
  WHERE plugin_id = ? AND session_id = ? AND trace_id = ?
`);

const listBySessionStmt = db.prepare(`
  SELECT id, plugin_id, session_id, trace_id, seq, phase, payload_json, created_at
  FROM plugin_chat_activity
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY trace_id ASC, seq ASC, id ASC
  LIMIT 500
`);

const listTailBySessionStmt = db.prepare(`
  SELECT id, plugin_id, session_id, trace_id, seq, phase, payload_json, created_at
  FROM plugin_chat_activity
  WHERE plugin_id = ? AND session_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

function buildListByTraceIdsSql(traceIdsCount: number): string {
  const placeholders = new Array(traceIdsCount).fill("?").join(", ");
  return `
    SELECT id, plugin_id, session_id, trace_id, seq, phase, payload_json, created_at
    FROM plugin_chat_activity
    WHERE plugin_id = ? AND session_id = ? AND trace_id IN (${placeholders})
    ORDER BY trace_id ASC, seq ASC, id ASC
  `;
}

export function appendPluginActivity(input: {
  pluginId: string;
  sessionId: string;
  traceId: string;
  phase: string;
  data: Record<string, unknown>;
}): void {
  const row = nextSeqStmt.get(input.pluginId, input.sessionId, input.traceId) as { next_seq: number };
  const seq = typeof row?.next_seq === "number" && Number.isFinite(row.next_seq) ? row.next_seq : 1;
  insertStmt.run({
    plugin_id: input.pluginId,
    session_id: input.sessionId,
    trace_id: input.traceId,
    seq,
    phase: input.phase,
    payload_json: JSON.stringify(input.data ?? {}),
    created_at: new Date().toISOString()
  });
}

export function listPluginActivitiesBySession(pluginId: string, sessionId: string): PluginChatActivityRow[] {
  return listBySessionStmt.all(pluginId, sessionId) as PluginChatActivityRow[];
}

/** 按 id 倒序取最近若干条（调用方如需时间正序可自行 reverse） */
export function listPluginActivitiesTail(pluginId: string, sessionId: string, limit: number): PluginChatActivityRow[] {
  return listTailBySessionStmt.all(pluginId, sessionId, limit) as PluginChatActivityRow[];
}

export function listPluginActivitiesByTraceIds(
  pluginId: string,
  sessionId: string,
  traceIds: string[]
): PluginChatActivityRow[] {
  if (traceIds.length === 0) return [];
  const sql = buildListByTraceIdsSql(traceIds.length);
  const stmt = db.prepare(sql);
  return stmt.all(pluginId, sessionId, ...traceIds) as PluginChatActivityRow[];
}
