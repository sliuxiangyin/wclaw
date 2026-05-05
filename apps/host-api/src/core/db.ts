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
  CREATE TABLE IF NOT EXISTS plugin_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

try {
  db.exec(`ALTER TABLE plugin_chat_messages ADD COLUMN source_type TEXT DEFAULT 'runtime';`);
} catch {
  // no-op: column already exists
}
try {
  db.exec(`ALTER TABLE plugin_chat_messages ADD COLUMN source_plugin_id TEXT;`);
} catch {
  // no-op: column already exists
}
try {
  db.exec(`ALTER TABLE plugin_chat_messages ADD COLUMN llm_eligible INTEGER DEFAULT 1;`);
} catch {
  // no-op: column already exists
}
try {
  db.exec(`ALTER TABLE plugin_chat_messages ADD COLUMN context_summary TEXT;`);
} catch {
  // no-op: column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    isolated_plugin_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (plugin_id, session_id)
  );
`);

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
  CREATE TABLE IF NOT EXISTS plugin_chat_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plugin_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    phase TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_plugin_chat_activity_session
  ON plugin_chat_activity(plugin_id, session_id);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_plugin_chat_activity_trace
  ON plugin_chat_activity(trace_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
