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
    sessions: Array<{ sessionId: string; title: string; updatedAt: string }>;
  };
  error: ApiError;
};

export type PluginChatTimelineMessage = {
  kind: "message";
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sourceType: "runtime" | "plugin";
  sourcePluginId: string | null;
  llmEligible: boolean;
  contextSummary: string | null;
};

export type PluginChatTimelineActivity = {
  kind: "plugin_activity";
  id: number;
  traceId: string;
  seq: number;
  phase: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type PluginChatTimelineItem = PluginChatTimelineMessage | PluginChatTimelineActivity;

type HistoryTimelineResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessionId: string;
    limit: number;
    timeline: PluginChatTimelineItem[];
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
