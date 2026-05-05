import { apiGet } from "./client";

export type LlmConfig = {
  providerType: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  enableStreaming: boolean;
};

type LlmConfigResponse = {
  ok: boolean;
  data: { scope: string; config: LlmConfig };
  error: { code: string; message: string } | null;
};

export async function getLlmConfig(): Promise<LlmConfig> {
  const payload = await apiGet<LlmConfigResponse>("/api/llm/config");
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "failed to load llm config");
  }
  return payload.data.config;
}

export async function saveLlmConfig(config: LlmConfig): Promise<LlmConfig> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
  const res = await fetch(`${base}/api/llm/config`, {
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
  return payload.data.config;
}
