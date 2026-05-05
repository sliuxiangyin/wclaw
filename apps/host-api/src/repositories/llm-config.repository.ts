import { db } from "../core/db.js";

type LlmConfigRow = {
  scope: string;
  config_json: string;
  updated_at: string;
};

const DEFAULT_SCOPE = "global";

const getStmt = db.prepare("SELECT scope, config_json, updated_at FROM llm_config WHERE scope = ?");
const upsertStmt = db.prepare(`
  INSERT INTO llm_config (scope, config_json, updated_at)
  VALUES (@scope, @config_json, @updated_at)
  ON CONFLICT(scope) DO UPDATE SET
    config_json = excluded.config_json,
    updated_at = excluded.updated_at
`);

export function getLlmConfig(scope = DEFAULT_SCOPE): Record<string, unknown> {
  const row = getStmt.get(scope) as LlmConfigRow | undefined;
  if (!row) {
    return {
      providerType: "custom",
      baseURL: "",
      apiKey: "",
      model: "",
      temperature: 0.7,
      maxTokens: 2048,
      timeoutMs: 30000,
      enableStreaming: true
    };
  }
  return JSON.parse(row.config_json) as Record<string, unknown>;
}

export function saveLlmConfig(config: Record<string, unknown>, scope = DEFAULT_SCOPE) {
  upsertStmt.run({
    scope,
    config_json: JSON.stringify(config),
    updated_at: new Date().toISOString()
  });
}
