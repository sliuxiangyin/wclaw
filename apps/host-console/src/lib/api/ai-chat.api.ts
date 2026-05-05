import type { UIMessage, UIMessageChunk } from "ai";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/** 宿主 SSE chunk `type: plugin-activity`（不入 UIMessage / LLM 上下文） */
export type PluginActivityPayload = {
  phase: string;
  /** 其它字段任意；`summary` 为控制台展示用，由插件组装 */
  data?: Record<string, unknown> & { summary?: string };
};

type AiChatResponse = {
  ok: boolean;
  data: {
    pluginId: string;
    sessionId: string;
    reply: string;
    sourceType: "runtime" | "plugin";
    sourcePluginId: string | null;
    llmEligible: boolean;
    contextSummary: string | null;
    mode: "normal" | "isolated";
    isolatedPluginId: string | null;
  };
  error: { code: string; message: string } | null;
};

export async function postAiChat(input: {
  pluginId: string;
  sessionId: string;
  messages: UIMessage[];
  model?: string;
}) {
  const messages = input.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: extractTextFromUiMessage(m)
  }));

  const res = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pluginId: input.pluginId,
      sessionId: input.sessionId,
      messages,
      model: input.model
    })
  });

  const payload = (await res.json()) as AiChatResponse;
  if (!res.ok || !payload.ok || payload.error) {
    throw new Error(payload.error?.message ?? "ai chat failed");
  }
  return payload.data;
}

export async function postAiChatStream(input: {
  pluginId: string;
  sessionId: string;
  messages: UIMessage[];
  model?: string;
  onFinish?: () => void;
  /** 与主消息流并行；不 enqueue 到 UIMessageChunk，避免进入 assistant-ui 消息与 LLM 历史 */
  onPluginActivity?: (payload: PluginActivityPayload) => void;
}): Promise<ReadableStream<UIMessageChunk>> {
  const messages = input.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: extractTextFromUiMessage(m)
  }));
  const res = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify({
      pluginId: input.pluginId,
      sessionId: input.sessionId,
      messages,
      model: input.model
    })
  });

  if (!res.ok || !res.body) {
    throw new Error("ai chat stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (!finished) {
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.enqueue({ type: "finish-step" });
            controller.enqueue({ type: "finish" });
            input.onFinish?.();
          }
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;

          if (event.event === "error") {
            const message = typeof event.data?.message === "string" ? event.data.message : "stream error";
            controller.error(new Error(message));
            return;
          }

          if (event.event === "chunk") {
            const raw = event.data;
            if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.type === "plugin-activity") {
              const phase = typeof raw.phase === "string" ? raw.phase : "";
              const d = raw.data;
              const data =
                typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : undefined;
              input.onPluginActivity?.({ phase, data });
              continue;
            }
            if (raw && typeof raw === "object" && !Array.isArray(raw) && raw.type === "data-trace") {
              continue;
            }
            const chunk = toUiMessageChunk(event.data);
            if (!chunk) {
              continue;
            }
            controller.enqueue(chunk);
            if (chunk.type === "finish") {
              finished = true;
              input.onFinish?.();
              controller.close();
              return;
            }
            continue;
          }
        }
      }
    },
    cancel() {
      void reader.cancel();
    }
  });
}

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

function extractTextFromUiMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n")
    .trim();
}

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> | null } | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) return { event, data: null };
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) as Record<string, unknown> };
  } catch {
    return { event, data: null };
  }
}

function toUiMessageChunk(data: Record<string, unknown> | null): UIMessageChunk | null {
  if (!data || typeof data.type !== "string") {
    return null;
  }
  const type = data.type;
  if (type === "start") {
    return {
      type: "start",
      messageMetadata: isObject(data.messageMetadata) ? data.messageMetadata : undefined
    };
  }
  if (type === "start-step" || type === "finish-step" || type === "finish") {
    return { type };
  }
  if (type === "text-start" || type === "text-end") {
    return { type, id: typeof data.id === "string" ? data.id : "text-1" };
  }
  if (type === "text-delta") {
    return {
      type: "text-delta",
      id: typeof data.id === "string" ? data.id : "text-1",
      delta: typeof data.delta === "string" ? data.delta : ""
    };
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
