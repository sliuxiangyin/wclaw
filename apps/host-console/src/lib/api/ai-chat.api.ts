const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type AiChatEventsResponse = {
  ok: boolean;
  data: {
    items: Array<{
      id: number;
      traceId: string | null;
      pluginId: string;
      sessionId: string;
      type: string;
      source: "host" | "llm" | "plugin" | "tool";
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
    pagination: {
      limit: number;
      offset: number;
    };
  };
  error: { code: string; message: string } | null;
};

export async function getAiChatEvents(input: {
  pluginId: string;
  sessionId?: string;
  type?: string;
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  query.set("pluginId", input.pluginId);
  if (input.sessionId) query.set("sessionId", input.sessionId);
  if (input.type) query.set("type", input.type);
  if (typeof input.limit === "number") query.set("limit", String(input.limit));
  if (typeof input.offset === "number") query.set("offset", String(input.offset));

  const res = await fetch(`${API_BASE_URL}/api/ai/events?${query.toString()}`);
  const payload = (await res.json()) as AiChatEventsResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "load ai events failed");
  }
  return payload.data.items;
}

