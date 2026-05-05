import { apiGet, apiPostJson, apiPutJson } from "./client";

type Envelope<T> = {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  traceId: string | null;
};

export type McpTransport = "stdio" | "http";

export type McpServerStoredConfig = {
  id: string;
  displayName?: string;
  enabled: boolean;
  transport: McpTransport;
  notes?: string;
  stdio?: { command: string; args?: string[]; cwd?: string | null; env?: Record<string, string> } | null;
  http?: { url: string; headers?: Record<string, string>; sessionId?: string } | null;
};

export type McpToolSnapshot = {
  name: string;
  description?: string;
};

export type McpServerStatusSnapshot = {
  lastProbeAt: string | null;
  ok: boolean;
  errorMessage?: string;
  tools: Array<McpToolSnapshot & { inputSchema?: Record<string, unknown> }>;
};

export type McpServerSummaryDto = {
  id: string;
  displayName?: string;
  enabled: boolean;
  transport: McpTransport;
  status: McpServerStatusSnapshot;
  updated_at: string;
};

export type McpServerDetailDto = {
  id: string;
  config: McpServerStoredConfig;
  status: McpServerStatusSnapshot;
  updated_at: string;
};

function unwrap<T>(payload: Envelope<T>): T {
  if (!payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "请求失败");
  }
  return payload.data as T;
}

export async function fetchMcpServerList(): Promise<McpServerSummaryDto[]> {
  const payload = await apiGet<Envelope<{ servers: McpServerSummaryDto[] }>>("/api/mcp/servers");
  const data = unwrap(payload);
  return data.servers;
}

export async function fetchMcpServerDetail(id: string): Promise<McpServerDetailDto> {
  const payload = await apiGet<Envelope<McpServerDetailDto>>(`/api/mcp/servers/${encodeURIComponent(id)}`);
  return unwrap(payload);
}

export async function saveMcpServer(config: McpServerStoredConfig): Promise<McpServerDetailDto> {
  const payload = await apiPutJson<Envelope<McpServerDetailDto>>(
    `/api/mcp/servers/${encodeURIComponent(config.id)}`,
    config
  );
  return unwrap(payload);
}

export async function deleteMcpServer(id: string): Promise<void> {
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
  const res = await fetch(`${base}/api/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
  const payload = (await res.json()) as Envelope<{ deleted: boolean; id: string }>;
  unwrap(payload);
}

export async function probeMcpServer(id: string): Promise<McpServerStatusSnapshot> {
  const payload = await apiPostJson<Envelope<{ id: string; status: McpServerStatusSnapshot }>>(
    `/api/mcp/servers/${encodeURIComponent(id)}/probe`,
    {}
  );
  const data = unwrap(payload);
  return data.status;
}
