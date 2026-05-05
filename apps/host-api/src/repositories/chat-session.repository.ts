import { db } from "../core/db.js";

export type ChatSessionState = {
  pluginId: string;
  sessionId: string;
  mode: "normal" | "isolated";
  isolatedPluginId: string | null;
  updatedAt: string;
};

const getStmt = db.prepare(`
  SELECT plugin_id, session_id, mode, isolated_plugin_id, updated_at
  FROM chat_sessions
  WHERE plugin_id = ? AND session_id = ?
`);

const upsertStmt = db.prepare(`
  INSERT INTO chat_sessions (plugin_id, session_id, mode, isolated_plugin_id, updated_at)
  VALUES (@plugin_id, @session_id, @mode, @isolated_plugin_id, @updated_at)
  ON CONFLICT(plugin_id, session_id) DO UPDATE SET
    mode = excluded.mode,
    isolated_plugin_id = excluded.isolated_plugin_id,
    updated_at = excluded.updated_at
`);

export function getChatSessionState(pluginId: string, sessionId: string): ChatSessionState {
  const row = getStmt.get(pluginId, sessionId) as
    | {
        plugin_id: string;
        session_id: string;
        mode: "normal" | "isolated";
        isolated_plugin_id: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      pluginId,
      sessionId,
      mode: "normal",
      isolatedPluginId: null,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    pluginId: row.plugin_id,
    sessionId: row.session_id,
    mode: row.mode,
    isolatedPluginId: row.isolated_plugin_id,
    updatedAt: row.updated_at
  };
}

export function saveChatSessionState(state: Omit<ChatSessionState, "updatedAt">) {
  upsertStmt.run({
    plugin_id: state.pluginId,
    session_id: state.sessionId,
    mode: state.mode,
    isolated_plugin_id: state.isolatedPluginId,
    updated_at: new Date().toISOString()
  });
}
