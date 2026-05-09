import type { UIMessage } from "ai";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type ApiError = { code: string; message: string } | null;

type ChatMessage = {
  id: number;
  plugin_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

type ChatResponse = {
  ok: boolean;
  data: {
    sessionId: string;
    reply: string;
    messages: ChatMessage[];
  };
  error: ApiError;
};

type CommandResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    command: string;
    output: string;
  };
  error: ApiError;
};

type SessionsResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessions: PluginSessionRowDto[];
  };
  error: ApiError;
};

export type PluginSessionRowDto = {
  sessionId: string;
  updatedAt: string;
  title?: string;
  persistence?: "persist" | "ephemeral";
  forceExecuteTurn?: boolean;
  ui?: {
    subtitle?: string;
    description?: string;
    badges?: string[];
    welcome?: string;
    suggestions?: Array<{ prompt: string; text?: string }>;
    avatarUrl?: string;
    coverUrl?: string;
  };
};

type HistoryTimelineResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessionId: string;
    limit: number;
    messages: UIMessage[];
  };
  error: ApiError;
};

export async function sendPluginChat(pluginId: string, sessionId: string, message: string) {
  const res = await fetch(`${API_BASE_URL}/api/plugins/${pluginId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message })
  });
  const payload = (await res.json()) as ChatResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "chat failed");
  }
  return payload.data;
}

export async function runPluginCommand(pluginId: string, command: string) {
  const res = await fetch(`${API_BASE_URL}/api/plugins/${pluginId}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command })
  });
  const payload = (await res.json()) as CommandResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "command failed");
  }
  return payload.data;
}

export async function getPluginSessions(pluginId: string) {
  const res = await fetch(`${API_BASE_URL}/api/plugins/${pluginId}/sessions`);
  const payload = (await res.json()) as SessionsResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "load sessions failed");
  }
  return payload.data.sessions;
}

export async function switchPluginSession(pluginId: string, sessionId: string) {
  const res = await fetch(`${API_BASE_URL}/api/plugins/${pluginId}/sessions/${sessionId}/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  if (!res.ok) throw new Error(`switch session failed: ${res.status}`);
}

export async function getPluginChatHistoryTimeline(pluginId: string, sessionId: string, limit?: number) {
  const q = limit !== undefined && Number.isFinite(limit) ? `?limit=${encodeURIComponent(String(limit))}` : "";
  const res = await fetch(
    `${API_BASE_URL}/api/plugins/${pluginId}/sessions/${encodeURIComponent(sessionId)}/messages${q}`
  );
  const payload = (await res.json()) as HistoryTimelineResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "load history failed");
  }
  return payload.data;
}

type ClearSessionMessagesResponse = {
  ok: boolean;
  data: { pluginId: string; sessionId: string; deleted: number };
  error: ApiError;
};

export type McpToolForbidden = {
  servers: string[];
  tools: Record<string, string[]>;
};

type McpToolForbiddenResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessionId: string;
    mcpToolForbidden: McpToolForbidden;
  };
  error: ApiError;
};

export type PluginMcpAllowedCatalog = {
  servers: Array<{ id: string; displayName?: string }>;
  tools: Array<{ serverId: string; name: string; description?: string }>;
};

type McpAllowedCatalogResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessionId: string;
    mcpAllowedCatalog: PluginMcpAllowedCatalog;
    mcpToolForbidden: McpToolForbidden;
  };
  error: ApiError;
};

export async function clearPluginSessionMessages(pluginId: string, sessionId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/plugins/${pluginId}/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: "DELETE" }
  );
  const payload = (await res.json()) as ClearSessionMessagesResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "clear session messages failed");
  }
  return payload.data;
}

type CancelAiChatRunResponse = {
  ok: boolean;
  data: { pluginId: string; sessionId: string; cancelled: boolean };
  error: ApiError;
};

export async function cancelAiChatRun(pluginId: string, sessionId: string) {
  const res = await fetch(`${API_BASE_URL}/api/ai/chat/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wclaw-Plugin-Id": pluginId,
      "X-Wclaw-Session-Id": sessionId
    },
    body: JSON.stringify({ pluginId, sessionId })
  });
  const payload = (await res.json()) as CancelAiChatRunResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "cancel ai chat run failed");
  }
  return payload.data;
}

export async function getSessionMcpToolForbidden(pluginId: string, sessionId: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/plugins/${pluginId}/sessions/${encodeURIComponent(sessionId)}/mcp-tool-forbidden`
  );
  const payload = (await res.json()) as McpToolForbiddenResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "load mcp tool forbidden failed");
  }
  return payload.data.mcpToolForbidden;
}

export async function getSessionMcpAllowedCatalog(pluginId: string, sessionId: string): Promise<{
  mcpAllowedCatalog: PluginMcpAllowedCatalog;
  mcpToolForbidden: McpToolForbidden;
}> {
  const res = await fetch(
    `${API_BASE_URL}/api/plugins/${pluginId}/sessions/${encodeURIComponent(sessionId)}/mcp-allowed-catalog`
  );
  const payload = (await res.json()) as McpAllowedCatalogResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "load mcp allowed catalog failed");
  }
  return {
    mcpAllowedCatalog: payload.data.mcpAllowedCatalog,
    mcpToolForbidden: payload.data.mcpToolForbidden
  };
}

export async function saveSessionMcpToolForbidden(
  pluginId: string,
  sessionId: string,
  mcpToolForbidden: McpToolForbidden
) {
  const res = await fetch(
    `${API_BASE_URL}/api/plugins/${pluginId}/sessions/${encodeURIComponent(sessionId)}/mcp-tool-forbidden`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mcpToolForbidden)
    }
  );
  const payload = (await res.json()) as McpToolForbiddenResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "save mcp tool forbidden failed");
  }
  return payload.data.mcpToolForbidden;
}
