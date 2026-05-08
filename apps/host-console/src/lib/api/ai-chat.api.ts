import type { UIMessage, UIMessageChunk } from "ai";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/** 宿主 SSE chunk `type: data-plugin_activity`（不入 UIMessage / LLM 上下文） */
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
  onRunCreated?: (runId: string) => void;
  onChunkSeq?: (seq: number) => void;
  /** 与主消息流并行；不 enqueue 到 UIMessageChunk，避免进入 assistant-ui 消息与 LLM 历史 */
  onPluginActivity?: (payload: PluginActivityPayload) => void;
  resume?: { runId: string; lastSeq: number };
}): Promise<ReadableStream<UIMessageChunk>> {
  const messages = input.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: extractTextFromUiMessage(m)
  }));
  const runId = input.resume?.runId
    ? input.resume.runId
    : await createAiRun({ pluginId: input.pluginId, sessionId: input.sessionId, messages, model: input.model });
  input.onRunCreated?.(runId);
  const streamUrl = new URL(`${API_BASE_URL}/api/ai/runs/${encodeURIComponent(runId)}/stream`);
  if (input.resume?.lastSeq && input.resume.lastSeq > 0) {
    streamUrl.searchParams.set("lastSeq", String(input.resume.lastSeq));
  }
  const res = await fetch(streamUrl.toString(), {
    method: "GET",
    headers: { Accept: "text/event-stream" }
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
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
            const seq = typeof raw.seq === "number" ? raw.seq : 0;
            const chunkRaw =
              "chunk" in raw && typeof raw.chunk === "object" && raw.chunk !== null && !Array.isArray(raw.chunk)
                ? (raw.chunk as Record<string, unknown>)
                : (raw as Record<string, unknown>);
            if (seq > 0) {
              input.onChunkSeq?.(seq);
            }
            if (chunkRaw.type === "data-plugin_activity") {
              const d = chunkRaw.data;
              const obj =
                typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
              const phase = typeof obj.phase === "string" ? obj.phase : "";
              const data =
                Object.keys(obj).length > 0
                  ? Object.fromEntries(Object.entries(obj).filter(([k]) => k !== "phase"))
                  : undefined;
              input.onPluginActivity?.({ phase, data });
              continue;
            }
            if (chunkRaw.type === "data-trace") {
              continue;
            }
            const chunk = toUiMessageChunk(chunkRaw);
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

export async function cancelAiRun(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/ai/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
  if (!res.ok) {
    throw new Error("cancel run failed");
  }
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
  const MAX_LINE_LEN = 320;
  const MAX_TOTAL_LEN = 1600;
  const lines: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      if ("text" in part && typeof part.text === "string" && part.text.trim()) {
        lines.push(truncateText(part.text.trim(), MAX_LINE_LEN));
      }
      continue;
    }
    if (part.type === "reasoning") {
      if ("text" in part && typeof part.text === "string" && part.text.trim()) {
        lines.push(`[reasoning] ${truncateText(part.text.trim(), MAX_LINE_LEN)}`);
      }
      continue;
    }
    if (part.type === "tool-call") {
      const toolName = typeof part.toolName === "string" ? part.toolName : "unknown_tool";
      const args = "args" in part ? summarizeToolInput((part as { args?: unknown }).args) : "{}";
      const result = "result" in part ? summarizeToolOutput((part as { result?: unknown }).result) : "";
      const status =
        "status" in part && part.status
          ? part.status.type === "complete"
            ? "complete"
            : part.status.type === "running"
              ? "running"
              : part.status.reason === "cancelled"
                ? "cancelled"
                : "error"
          : "unknown";
      lines.push(truncateText(`[tool:${toolName}] status=${status} input=${args}${result ? ` output=${result}` : ""}`, MAX_LINE_LEN));
      continue;
    }
    if (part.type === "dynamic-tool") {
      const toolName = typeof part.toolName === "string" ? part.toolName : "unknown_tool";
      const state = "state" in part ? String((part as { state?: unknown }).state ?? "unknown") : "unknown";
      const inputJson = summarizeToolInput("input" in part ? (part as { input?: unknown }).input : {});
      const outputJson = summarizeToolOutput("output" in part ? (part as { output?: unknown }).output : undefined);
      const errorText =
        "errorText" in part && typeof (part as { errorText?: unknown }).errorText === "string"
          ? (part as { errorText: string }).errorText
          : "";
      lines.push(truncateText(
        `[tool:${toolName}] state=${state} input=${inputJson}${outputJson ? ` output=${outputJson}` : ""}${
          errorText ? ` error=${truncateText(errorText, 120)}` : ""
        }`,
        MAX_LINE_LEN
      ));
      continue;
    }
  }
  const merged = lines.join("\n").trim();
  return truncateText(merged, MAX_TOTAL_LEN);
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…<truncated>`;
}

function summarizeToolInput(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const rec = input as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    if (typeof rec.url === "string") picked.url = rec.url;
    if (typeof rec.target === "string") picked.target = rec.target;
    if (typeof rec.text === "string") picked.text = truncateText(rec.text, 80);
    if (Object.keys(picked).length > 0) return JSON.stringify(picked);
  }
  return truncateText(safeJson(input), 180);
}

function summarizeToolOutput(output: unknown): string {
  if (output == null) return "";
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const rec = output as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    if (typeof rec.isError === "boolean") picked.isError = rec.isError;
    if (typeof rec.title === "string") picked.title = rec.title;
    if (typeof rec.url === "string") picked.url = rec.url;
    if (Array.isArray(rec.content) && rec.content.length > 0) {
      const first = rec.content[0];
      if (first && typeof first === "object" && !Array.isArray(first) && typeof (first as { text?: unknown }).text === "string") {
        picked.contentText = truncateText((first as { text: string }).text, 120);
      }
    }
    if (Object.keys(picked).length > 0) return JSON.stringify(picked);
  }
  return truncateText(safeJson(output), 220);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

async function createAiRun(input: {
  pluginId: string;
  sessionId: string;
  messages: Array<{ id: string; role: string; content: string }>;
  model?: string;
}) {
  const res = await fetch(`${API_BASE_URL}/api/ai/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = (await res.json()) as {
    ok: boolean;
    data?: { runId?: string };
    error?: { message?: string } | null;
  };
  if (!res.ok || !payload.ok || !payload.data?.runId) {
    throw new Error(payload.error?.message ?? "create run failed");
  }
  return payload.data.runId;
}

function toUiMessageChunk(data: Record<string, unknown> | null): UIMessageChunk | null {
  if (!data || typeof data.type !== "string") {
    return null;
  }
  return data as unknown as UIMessageChunk;
}

