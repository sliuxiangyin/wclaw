import { db } from "../core/db.js";

export type ChatSessionState = {
  pluginId: string;
  sessionId: string;
  mode: "normal" | "isolated";
  isolatedPluginId: string | null;
  mcpToolForbidden: McpToolForbidden;
  updatedAt: string;
};

export type McpToolForbidden = {
  servers: string[];
  tools: Record<string, string[]>;
};

const EMPTY_MCP_TOOL_FORBIDDEN: McpToolForbidden = {
  servers: [],
  tools: {}
};

const getStmt = db.prepare(`
  SELECT plugin_id, session_id, mode, isolated_plugin_id, mcp_tool_forbidden, updated_at
  FROM chat_sessions
  WHERE plugin_id = ? AND session_id = ?
`);

const upsertStmt = db.prepare(`
  INSERT INTO chat_sessions (plugin_id, session_id, mode, isolated_plugin_id, mcp_tool_forbidden, updated_at)
  VALUES (@plugin_id, @session_id, @mode, @isolated_plugin_id, @mcp_tool_forbidden, @updated_at)
  ON CONFLICT(plugin_id, session_id) DO UPDATE SET
    mode = excluded.mode,
    isolated_plugin_id = excluded.isolated_plugin_id,
    mcp_tool_forbidden = excluded.mcp_tool_forbidden,
    updated_at = excluded.updated_at
`);

const deleteStmt = db.prepare(
  `DELETE FROM chat_sessions WHERE plugin_id = ? AND session_id = ?`
);

function normalizeMcpToolForbidden(input: unknown): McpToolForbidden {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return EMPTY_MCP_TOOL_FORBIDDEN;
  }
  const raw = input as { servers?: unknown; tools?: unknown };
  const servers = Array.isArray(raw.servers)
    ? raw.servers.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  const toolsObj: Record<string, string[]> = {};
  if (raw.tools && typeof raw.tools === "object" && !Array.isArray(raw.tools)) {
    for (const [serverId, value] of Object.entries(raw.tools as Record<string, unknown>)) {
      if (typeof serverId !== "string" || serverId.trim() === "") continue;
      if (!Array.isArray(value)) continue;
      toolsObj[serverId] = value
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim());
    }
  }
  return {
    servers: [...new Set(servers)],
    tools: toolsObj
  };
}

export function getChatSessionState(pluginId: string, sessionId: string): ChatSessionState {
  const row = getStmt.get(pluginId, sessionId) as
    | {
        plugin_id: string;
        session_id: string;
        mode: "normal" | "isolated";
        isolated_plugin_id: string | null;
        mcp_tool_forbidden: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return {
      pluginId,
      sessionId,
      mode: "normal",
      isolatedPluginId: null,
      mcpToolForbidden: EMPTY_MCP_TOOL_FORBIDDEN,
      updatedAt: new Date().toISOString()
    };
  }

  const parsedForbidden = (() => {
    if (!row.mcp_tool_forbidden) return EMPTY_MCP_TOOL_FORBIDDEN;
    try {
      return normalizeMcpToolForbidden(JSON.parse(row.mcp_tool_forbidden));
    } catch {
      return EMPTY_MCP_TOOL_FORBIDDEN;
    }
  })();

  return {
    pluginId: row.plugin_id,
    sessionId: row.session_id,
    mode: row.mode,
    isolatedPluginId: row.isolated_plugin_id,
    mcpToolForbidden: parsedForbidden,
    updatedAt: row.updated_at
  };
}

export function saveChatSessionState(state: Omit<ChatSessionState, "updatedAt">) {
  const forbidden = normalizeMcpToolForbidden(state.mcpToolForbidden);
  upsertStmt.run({
    plugin_id: state.pluginId,
    session_id: state.sessionId,
    mode: state.mode,
    isolated_plugin_id: state.isolatedPluginId,
    mcp_tool_forbidden: JSON.stringify(forbidden),
    updated_at: new Date().toISOString()
  });
}

/** 删除某插件某会话会话态（mode / isolated / mcpToolForbidden）；返回是否删除 */
export function deleteChatSessionState(pluginId: string, sessionId: string): boolean {
  const r = deleteStmt.run(pluginId, sessionId);
  return typeof r.changes === "number" ? r.changes > 0 : false;
}
