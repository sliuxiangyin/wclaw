import crypto from "node:crypto";
import { db } from "../core/db.js";

type LlmConfigRow = {
  scope: string;
  config_json: string;
  updated_at: string;
};

export const DEFAULT_LLM_SCOPE = "global";
/** 元数据行：config_json 为 `{"activeScope":"<scope>"}` */
const META_ACTIVE_SCOPE = "__llm_active_scope__";

const getStmt = db.prepare("SELECT scope, config_json, updated_at FROM llm_config WHERE scope = ?");
const upsertStmt = db.prepare(`
  INSERT INTO llm_config (scope, config_json, updated_at)
  VALUES (@scope, @config_json, @updated_at)
  ON CONFLICT(scope) DO UPDATE SET
    config_json = excluded.config_json,
    updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare("DELETE FROM llm_config WHERE scope = ?");
const listStmt = db.prepare(
  "SELECT scope, config_json, updated_at FROM llm_config WHERE scope != ? ORDER BY updated_at DESC"
);

export function defaultLlmConfigObject(): Record<string, unknown> {
  return {
    displayName: "默认配置",
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

function parseActivePointer(row: LlmConfigRow | undefined): string {
  if (!row) return DEFAULT_LLM_SCOPE;
  try {
    const parsed = JSON.parse(row.config_json) as { activeScope?: unknown };
    if (typeof parsed.activeScope === "string" && parsed.activeScope.length > 0) {
      return parsed.activeScope;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LLM_SCOPE;
}

/** 当前用于 AI 调用与未带 scope 的读写 */
export function getActiveLlmScope(): string {
  const pointerRow = getStmt.get(META_ACTIVE_SCOPE) as LlmConfigRow | undefined;
  const candidate = parseActivePointer(pointerRow);
  if (candidate === DEFAULT_LLM_SCOPE) {
    return DEFAULT_LLM_SCOPE;
  }
  const target = getStmt.get(candidate) as LlmConfigRow | undefined;
  if (!target) return DEFAULT_LLM_SCOPE;
  return candidate;
}

export function setActiveLlmScope(scope: string): void {
  if (scope === META_ACTIVE_SCOPE) {
    throw new Error("invalid scope");
  }
  if (scope !== DEFAULT_LLM_SCOPE) {
    const row = getStmt.get(scope) as LlmConfigRow | undefined;
    if (!row) {
      throw new Error("scope not found");
    }
  }
  upsertStmt.run({
    scope: META_ACTIVE_SCOPE,
    config_json: JSON.stringify({ activeScope: scope }),
    updated_at: new Date().toISOString()
  });
}

export type LlmProfileRow = {
  scope: string;
  config: Record<string, unknown>;
  updatedAt: string;
};

export function listLlmProfiles(): LlmProfileRow[] {
  const rows = listStmt.all(META_ACTIVE_SCOPE) as LlmConfigRow[];
  const mapped = rows.map((row) => ({
    scope: row.scope,
    config: JSON.parse(row.config_json) as Record<string, unknown>,
    updatedAt: row.updated_at
  }));
  const hasGlobal = mapped.some((p) => p.scope === DEFAULT_LLM_SCOPE);
  if (!hasGlobal) {
    return [
      {
        scope: DEFAULT_LLM_SCOPE,
        config: defaultLlmConfigObject(),
        updatedAt: ""
      },
      ...mapped
    ];
  }
  return mapped;
}

/** 供 HTTP 层判断资源是否存在；`global` 无行时返回内存默认（与 getLlmConfig 一致） */
export function findLlmProfile(scope: string): LlmProfileRow | null {
  if (scope === META_ACTIVE_SCOPE) return null;
  const row = getStmt.get(scope) as LlmConfigRow | undefined;
  if (row) {
    return {
      scope: row.scope,
      config: JSON.parse(row.config_json) as Record<string, unknown>,
      updatedAt: row.updated_at
    };
  }
  if (scope === DEFAULT_LLM_SCOPE) {
    return {
      scope: DEFAULT_LLM_SCOPE,
      config: defaultLlmConfigObject(),
      updatedAt: ""
    };
  }
  return null;
}

export function createLlmProfile(partial?: Record<string, unknown>): LlmProfileRow {
  const scope = crypto.randomUUID();
  const base = defaultLlmConfigObject();
  const merged = partial ? { ...base, ...partial } : { ...base };
  merged.displayName = typeof partial?.displayName === "string" ? partial.displayName : "新配置";
  saveLlmConfig(merged, scope);
  const row = getStmt.get(scope) as LlmConfigRow;
  return {
    scope,
    config: JSON.parse(row.config_json) as Record<string, unknown>,
    updatedAt: row.updated_at
  };
}

export function deleteLlmProfile(scope: string): void {
  if (scope === META_ACTIVE_SCOPE) return;
  const wasActive = getActiveLlmScope() === scope;
  deleteStmt.run(scope);
  if (!wasActive) return;
  const remaining = listLlmProfiles().map((p) => p.scope);
  const next = remaining.includes(DEFAULT_LLM_SCOPE)
    ? DEFAULT_LLM_SCOPE
    : (remaining[0] ?? DEFAULT_LLM_SCOPE);
  setActiveLlmScope(next);
}

export function getLlmConfig(scope?: string): Record<string, unknown> {
  const resolved = scope ?? getActiveLlmScope();
  const row = getStmt.get(resolved) as LlmConfigRow | undefined;
  if (row) {
    return JSON.parse(row.config_json) as Record<string, unknown>;
  }
  if (resolved === DEFAULT_LLM_SCOPE) {
    return defaultLlmConfigObject();
  }
  return defaultLlmConfigObject();
}

export function saveLlmConfig(config: Record<string, unknown>, scope?: string) {
  const resolved = scope ?? getActiveLlmScope();
  upsertStmt.run({
    scope: resolved,
    config_json: JSON.stringify(config),
    updated_at: new Date().toISOString()
  });
}
