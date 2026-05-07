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
      activities: []
    });
  }
  timeline.sort((a, b) => a.id - b.id);

  const traceIds = [...traceIdSet];
  const activityRows = listPluginActivitiesByTraceIds(input.pluginId, input.sessionId, traceIds);
  const activitiesByTraceId: Record<string, PluginChatTimelineActivity[]> = {};
  for (const r of activityRows) {
    if (!activitiesByTraceId[r.trace_id]) activitiesByTraceId[r.trace_id] = [];
    activitiesByTraceId[r.trace_id].push({
      id: r.id,
      traceId: r.trace_id,
      seq: r.seq,
      phase: r.phase,
      data: parseActivityPayload(r.payload_json),
      createdAt: r.created_at
    });
  }

  for (const row of timeline) {
    if (row.role !== "assistant" || !row.traceId) continue;
    row.activities = activitiesByTraceId[row.traceId] ?? [];
  }

  return {
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    limit,
    timeline
  };
}
