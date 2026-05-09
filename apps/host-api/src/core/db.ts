import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbDir = path.resolve(process.cwd(), "var", "data");
fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, "host.db");
export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS plugin_configs (
    plugin_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS llm_config (
    scope TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS plugin_chat_ui_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    trace_id TEXT,
    role TEXT NOT NULL,
    ui_message_json TEXT NOT NULL,
    content_plain TEXT NOT NULL DEFAULT '',
    source_type TEXT DEFAULT 'runtime',
    source_plugin_id TEXT,
    llm_eligible INTEGER DEFAULT 1,
    context_summary TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(plugin_id, session_id, message_id)
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_plugin_chat_ui_messages_session
  ON plugin_chat_ui_messages(plugin_id, session_id, id);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_plugin_chat_ui_messages_trace
  ON plugin_chat_ui_messages(plugin_id, session_id, trace_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    isolated_plugin_id TEXT,
    mcp_tool_forbidden TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, session_id)
  );
`);

try {
  db.exec(`ALTER TABLE chat_sessions ADD COLUMN mcp_tool_forbidden TEXT;`);
} catch {
  // no-op: column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT,
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

/** 首次运行时插入默认 Playwright MCP（未探测）；与控制台「New MCP Server」默认值一致，`id` 必须与插件 allowedServers 一致 */
{
  const hasPlaywright = Boolean(
    db.prepare(`SELECT 1 AS ok FROM mcp_servers WHERE id = ?`).get("playwright") as { ok: number } | undefined
  );
  if (!hasPlaywright) {
    const now = new Date().toISOString();
    const config = {
      id: "playwright",
      displayName: "Playwright",
      enabled: true,
      transport: "stdio" as const,
      notes: "",
      stdio: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        cwd: null as string | null,
        env: {} as Record<string, string>
      },
      http: null
    };
    const status = {
      lastProbeAt: null as string | null,
      ok: false,
      errorMessage: "尚未探测",
      tools: [] as unknown[]
    };
    db.prepare(
      `INSERT INTO mcp_servers (id, config_json, status_json, updated_at) VALUES (@id, @config_json, @status_json, @updated_at)`
    ).run({
      id: "playwright",
      config_json: JSON.stringify(config),
      status_json: JSON.stringify(status),
      updated_at: now
    });
  }
}
