import { apiGet } from "./client";

/** 与宿主 `plugin-manifest.types.ts` / 清单 `guide` 字段一致（所有 kind 共用形状）。 */
export type PluginGuideSuggestion = {
  prompt: string;
  text?: string;
};

export type PluginGuideMultiSession = {
  defaultSessionWelcome?: string;
  sessionWelcome?: string;
  defaultSessionSuggestions?: PluginGuideSuggestion[];
  sessionSuggestions?: PluginGuideSuggestion[];
};

export type PluginGuide = {
  welcome?: string;
  suggestions?: PluginGuideSuggestion[];
  multiSession?: PluginGuideMultiSession;
};

export type PluginListItem = {
  pluginId: string;
  status: "valid" | "invalid";
  manifestPath: string;
  manifest?: {
    id: string;
    displayName: string;
    kind: "runtime_plugin" | "command_plugin";
    version: string;
    description: string;
    entry: string;
    capabilities: {
      chat?: boolean;
      [k: string]: unknown;
    };
    sessionProvider?: { mode?: string; [k: string]: unknown };
    configSchema?: Record<string, unknown>;
    defaultConfig?: Record<string, unknown>;
    guide?: PluginGuide;
  };
  errors?: string[];
};

type PluginListResponse = {
  ok: boolean;
  data: {
    items: PluginListItem[];
  };
  error: { code: string; message: string } | null;
  traceId: string | null;
};

export async function getPlugins(): Promise<PluginListItem[]> {
  const payload = await apiGet<PluginListResponse>("/api/plugins");
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to load plugins");
  }
  return payload.data.items;
}

type PluginConfigResponse = {
  ok: boolean;
  data: { pluginId: string; config: Record<string, unknown> };
  error: { code: string; message: string } | null;
  traceId: string | null;
};

type PluginConfigValidateResponse = {
  ok: boolean;
  data: { pluginId: string; valid: boolean; errors: string[] };
  error: { code: string; message: string } | null;
  traceId: string | null;
};

export async function getPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  const payload = await apiGet<PluginConfigResponse>(`/api/plugins/${pluginId}/config`);
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to load plugin config");
  }
  return payload.data.config ?? {};
}

export async function savePluginConfig(
  pluginId: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"}/api/plugins/${pluginId}/config`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    }
  );
  if (!res.ok) throw new Error(`save config failed: ${res.status}`);
  const payload = (await res.json()) as PluginConfigResponse;
  if (!payload.ok || payload.error) throw new Error(payload.error?.message ?? "save failed");
  return payload.data.config;
}

export async function validatePluginConfig(
  pluginId: string,
  config: Record<string, unknown>
): Promise<{ valid: boolean; errors: string[] }> {
  const res = await fetch(
    `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"}/api/plugins/${pluginId}/config/validate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config })
    }
  );
  if (!res.ok) throw new Error(`validate config failed: ${res.status}`);
  const payload = (await res.json()) as PluginConfigValidateResponse;
  if (!payload.ok || payload.error) throw new Error(payload.error?.message ?? "validate failed");
  return payload.data;
}
