import { apiGet } from "./client";

export type LlmConfig = {
  displayName?: string;
  providerType: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  enableStreaming: boolean;
};

export type LlmProfile = {
  scope: string;
  config: LlmConfig;
  updatedAt: string;
};

type ApiEnvelope<T> = {
  ok: boolean;
  data: T;
  error: { code: string; message: string } | null;
};

function baseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
}

function normalizeConfig(raw: Record<string, unknown>): LlmConfig {
  return {
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    providerType: typeof raw.providerType === "string" ? raw.providerType : "custom",
    baseURL: typeof raw.baseURL === "string" ? raw.baseURL : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    model: typeof raw.model === "string" ? raw.model : "",
    temperature: typeof raw.temperature === "number" ? raw.temperature : 0.7,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : 2048,
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : 30000,
    enableStreaming: typeof raw.enableStreaming === "boolean" ? raw.enableStreaming : true
  };
}

type LlmConfigResponse = ApiEnvelope<{ scope: string; config: Record<string, unknown> }>;

export async function getLlmConfig(): Promise<LlmConfig> {
  const payload = await apiGet<LlmConfigResponse>("/api/llm/config");
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to load llm config");
  }
  return normalizeConfig(payload.data.config);
}

export async function saveLlmConfig(config: LlmConfig): Promise<LlmConfig> {
  const res = await fetch(`${baseUrl()}/api/llm/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    throw new Error(`save llm config failed: ${res.status}`);
  }
  const payload = (await res.json()) as LlmConfigResponse;
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "save failed");
  }
  return normalizeConfig(payload.data.config);
}

type ProfilesListResponse = ApiEnvelope<{ profiles: LlmProfile[]; activeScope: string }>;

export async function listLlmProfiles(): Promise<{ profiles: LlmProfile[]; activeScope: string }> {
  const payload = await apiGet<ProfilesListResponse>("/api/llm/profiles");
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to list llm profiles");
  }
  const profiles = payload.data.profiles.map((p) => ({
    scope: p.scope,
    updatedAt: p.updatedAt,
    config: normalizeConfig(p.config as Record<string, unknown>)
  }));
  return { profiles, activeScope: payload.data.activeScope };
}

export async function createLlmProfile(partial?: Partial<LlmConfig>): Promise<LlmProfile> {
  const res = await fetch(`${baseUrl()}/api/llm/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partial ?? {})
  });
  if (!res.ok) {
    throw new Error(`create llm profile failed: ${res.status}`);
  }
  const payload = (await res.json()) as ApiEnvelope<LlmProfile & { config: Record<string, unknown> }>;
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "create failed");
  }
  return {
    scope: payload.data.scope,
    updatedAt: payload.data.updatedAt,
    config: normalizeConfig(payload.data.config as Record<string, unknown>)
  };
}

export async function getLlmProfile(scope: string): Promise<LlmProfile> {
  const payload = await apiGet<ApiEnvelope<LlmProfile & { config: Record<string, unknown> }>>(
    `/api/llm/profiles/${encodeURIComponent(scope)}`
  );
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to load profile");
  }
  return {
    scope: payload.data.scope,
    updatedAt: payload.data.updatedAt,
    config: normalizeConfig(payload.data.config as Record<string, unknown>)
  };
}

export async function saveLlmProfile(scope: string, config: LlmConfig): Promise<LlmConfig> {
  const res = await fetch(`${baseUrl()}/api/llm/profiles/${encodeURIComponent(scope)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    throw new Error(`save llm profile failed: ${res.status}`);
  }
  const payload = (await res.json()) as ApiEnvelope<{ scope: string; config: Record<string, unknown> }>;
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "save failed");
  }
  return normalizeConfig(payload.data.config);
}

export async function activateLlmProfile(scope: string): Promise<string> {
  const res = await fetch(
    `${baseUrl()}/api/llm/profiles/${encodeURIComponent(scope)}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }
  );
  if (!res.ok) {
    throw new Error(`activate llm profile failed: ${res.status}`);
  }
  const payload = (await res.json()) as ApiEnvelope<{ activeScope: string }>;
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "activate failed");
  }
  return payload.data.activeScope;
}

export async function deleteLlmProfile(scope: string): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/llm/profiles/${encodeURIComponent(scope)}`, {
    method: "DELETE"
  });
  if (!res.ok) {
    throw new Error(`delete llm profile failed: ${res.status}`);
  }
  const payload = (await res.json()) as ApiEnvelope<{ ok: boolean; activeScope: string }>;
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "delete failed");
  }
  return payload.data.activeScope;
}
