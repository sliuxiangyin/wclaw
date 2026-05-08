import { listPluginActivitiesByTraceIds } from "../../repositories/plugin-chat-activity.repository.js";
import { listChatMessagesTail } from "../../repositories/plugin-chat.repository.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";

export type PluginChatTimelineMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  traceId: string | null;
  sourceType: "runtime" | "plugin";
  sourcePluginId: string | null;
  llmEligible: boolean;
  contextSummary: string | null;
  parts: Array<Record<string, unknown>>;
  activities: PluginChatTimelineActivity[];
};

export type PluginChatTimelineActivity = {
  id: number;
  traceId: string;
  seq: number;
  phase: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type PluginChatTimelineLlmChunk = {
  id: number;
  traceId: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
};

function clampTimelineLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > 500) return 500;
  return n;
}

function parseActivityPayload(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // ignore
  }
  return {};
}

function asEpochMs(iso: string): number {
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

const TRACE_ASSOCIATION_WINDOW_MS = 30 * 60 * 1000;

export function getPluginChatHistoryTimeline(input: {
  pluginId: string;
  sessionId: string;
  limit?: number;
}): {
  pluginId: string;
  sessionId: string;
  limit: number;
  timeline: PluginChatTimelineMessage[];
} {
  assertPluginChatSessionId(input.pluginId, input.sessionId);
  const limit = clampTimelineLimit(input.limit);
  const msgRows = listChatMessagesTail(input.pluginId, input.sessionId, limit);
  const timeline: PluginChatTimelineMessage[] = [];
  const traceIdSet = new Set<string>();

  for (const r of msgRows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    const traceId = r.trace_id ?? null;
    if (r.role === "assistant" && traceId) {
      traceIdSet.add(traceId);
    }
    timeline.push({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      traceId,
      sourceType: r.source_type,
      sourcePluginId: r.source_plugin_id,
      llmEligible: r.llm_eligible !== 0,
      contextSummary: r.context_summary,
      parts: r.role === "assistant" ? [] : [{ type: "text", text: r.content }],
      activities: []
    });
  }
  timeline.sort((a, b) => a.id - b.id);

  const traceIds = [...traceIdSet];
  const activityRows = listPluginActivitiesByTraceIds(input.pluginId, input.sessionId, traceIds);
  const activitiesByTraceId: Record<string, PluginChatTimelineActivity[]> = {};
  const runChunksByTraceId: Record<string, PluginChatTimelineLlmChunk[]> = {};
  for (const r of activityRows) {
    const data = parseActivityPayload(r.payload_json);
    if (r.phase === "run.chunk") {
      if (!runChunksByTraceId[r.trace_id]) runChunksByTraceId[r.trace_id] = [];
      runChunksByTraceId[r.trace_id].push({
        id: r.id,
        traceId: r.trace_id,
        seq: r.seq,
        type: typeof data.type === "string" ? data.type : "unknown",
        data,
        createdAt: r.created_at
      });
      if (typeof data.type === "string" && data.type === "data-plugin_activity") {
        if (!activitiesByTraceId[r.trace_id]) activitiesByTraceId[r.trace_id] = [];
        const activityData =
          data.data && typeof data.data === "object" && !Array.isArray(data.data)
            ? (data.data as Record<string, unknown>)
            : {};
        const phase = typeof activityData.phase === "string" ? activityData.phase : "plugin.activity";
        const payload = Object.fromEntries(Object.entries(activityData).filter(([k]) => k !== "phase"));
        activitiesByTraceId[r.trace_id].push({
          id: r.id,
          traceId: r.trace_id,
          seq: r.seq,
          phase,
          data: payload,
          createdAt: r.created_at
        });
      }
    }
  }

  for (const row of timeline) {
    if (row.role !== "assistant" || !row.traceId) continue;
    const rowTs = asEpochMs(row.createdAt);
    const minTs = rowTs - TRACE_ASSOCIATION_WINDOW_MS;
    row.activities = (activitiesByTraceId[row.traceId] ?? []).filter((x) => {
      const ts = asEpochMs(x.createdAt);
      return ts >= minTs && ts <= rowTs;
    });
    row.parts = buildAssistantPartsForHistory({
      content: row.content,
      chunks: (runChunksByTraceId[row.traceId] ?? []).filter((x) => {
        const ts = asEpochMs(x.createdAt);
        return ts >= minTs && ts <= rowTs;
      })
    });
  }

  return {
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    limit,
    timeline
  };
}

type ToolHistoryState = {
  toolCallId: string;
  toolName: string;
  argsText: string;
  args?: unknown;
  output?: unknown;
  errorText?: string;
};

function buildAssistantPartsForHistory(input: {
  content: string;
  chunks: Array<{ type: string; data: Record<string, unknown> }>;
}): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  const historyChunks = input.chunks;
  const hasStructured = historyChunks.length > 0;
  const shouldHidePlaceholderText =
    hasStructured &&
    (input.content === "(empty llm response)" || input.content.startsWith("(tool-only response)"));
  if (!shouldHidePlaceholderText && input.content.trim().length > 0) {
    parts.push({ type: "text", text: input.content });
  }
  const reasoningText = historyChunks
    .filter((c) => c.type === "reasoning-delta")
    .map((c) => (typeof c.data.delta === "string" ? c.data.delta : ""))
    .join("");
  if (reasoningText.trim().length > 0) {
    parts.push({ type: "reasoning", text: reasoningText });
  }
  const toolById = new Map<string, ToolHistoryState>();
  for (const c of historyChunks) {
    if (typeof c.data.toolCallId !== "string") continue;
    const toolCallId = c.data.toolCallId;
    const cur: ToolHistoryState = toolById.get(toolCallId) ?? {
      toolCallId,
      toolName: typeof c.data.toolName === "string" ? c.data.toolName : "unknown",
      argsText: ""
    };
    if (typeof c.data.toolName === "string") cur.toolName = c.data.toolName;
    if (c.type === "tool-input-delta" && typeof c.data.inputTextDelta === "string") cur.argsText += c.data.inputTextDelta;
    if (c.type === "tool-input-available") cur.args = c.data.input;
    if (c.type === "tool-output-available") cur.output = c.data.output;
    if (c.type === "tool-output-error" && typeof c.data.errorText === "string") cur.errorText = c.data.errorText;
    toolById.set(toolCallId, cur);
  }
  for (const [, item] of toolById) {
    const parsedArgs = item.args !== undefined ? item.args : safeParseJson(item.argsText) ?? {};
    if (item.output !== undefined) {
      parts.push({
        type: "dynamic-tool",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        state: "output-available",
        input: parsedArgs,
        output: item.output
      });
    } else if (item.errorText) {
      parts.push({
        type: "dynamic-tool",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        state: "output-error",
        input: parsedArgs,
        errorText: item.errorText
      });
    } else {
      parts.push({
        type: "dynamic-tool",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        state: "input-available",
        input: parsedArgs
      });
    }
  }
  if (parts.length === 0) {
    parts.push({ type: "text", text: input.content || "(empty llm response)" });
  }
  return parts;
}

function safeParseJson(text: string): unknown | null {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
