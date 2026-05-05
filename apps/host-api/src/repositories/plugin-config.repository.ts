import { db } from "../core/db.js";

type ConfigRow = {
  plugin_id: string;
  config_json: string;
  updated_at: string;
};

const getStmt = db.prepare("SELECT plugin_id, config_json, updated_at FROM plugin_configs WHERE plugin_id = ?");
const upsertStmt = db.prepare(`
  INSERT INTO plugin_configs (plugin_id, config_json, updated_at)
  VALUES (@plugin_id, @config_json, @updated_at)
  ON CONFLICT(plugin_id) DO UPDATE SET
    config_json = excluded.config_json,
    updated_at = excluded.updated_at
`);

export function getPluginConfig(pluginId: string): Record<string, unknown> {
  const row = getStmt.get(pluginId) as ConfigRow | undefined;
  if (!row) return {};
  return JSON.parse(row.config_json) as Record<string, unknown>;
}

export function savePluginConfig(pluginId: string, config: Record<string, unknown>) {
  upsertStmt.run({
    plugin_id: pluginId,
    config_json: JSON.stringify(config),
    updated_at: new Date().toISOString()
  });
}
