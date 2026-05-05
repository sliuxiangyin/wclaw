import { listPluginActivitiesTail } from "../../repositories/plugin-chat-activity.repository.js";
import { listChatMessagesTail } from "../../repositories/plugin-chat.repository.js";
import { assertPluginChatSessionId } from "./plugin-chat-session-guard.js";

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

function clampTimelineLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 100;
  const n = Math.floor(limit);
  if (n < 1) return 1;
  if (n > 500) return 500;
  return n;
}

function timelineSort(a: PluginChatTimelineItem, b: PluginChatTimelineItem): number {
  const t = a.createdAt.localeCompare(b.createdAt);
  if (t !== 0) return t;
  if (a.kind !== b.kind) return a.kind === "message" ? -1 : 1;
  return a.id - b.id;
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

/**
 * 最近窗口：从消息表与活动表各取最多 `pool` 条（按 id 倒序），合并按时间排序后截取末尾 `limit` 条。
 * 不入 LLM；仅供历史 UI。
 */
export function getPluginChatHistoryTimeline(input: {
  pluginId: string;
  sessionId: string;
  limit?: number;
}): { pluginId: string; sessionId: string; limit: number; timeline: PluginChatTimelineItem[] } {
  assertPluginChatSessionId(input.pluginId, input.sessionId);
  const limit = clampTimelineLimit(input.limit);
  const pool = Math.min(500, Math.max(limit, 80));

  const msgRows = listChatMessagesTail(input.pluginId, input.sessionId, pool);
  const actRows = listPluginActivitiesTail(input.pluginId, input.sessionId, pool);

  const items: PluginChatTimelineItem[] = [];

  for (const r of msgRows) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    items.push({
      kind: "message",
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      sourceType: r.source_type,
      sourcePluginId: r.source_plugin_id,
      llmEligible: r.llm_eligible !== 0,
      contextSummary: r.context_summary
    });
  }

  for (const r of actRows) {
    items.push({
      kind: "plugin_activity",
      id: r.id,
      traceId: r.trace_id,
      seq: r.seq,
      phase: r.phase,
      data: parseActivityPayload(r.payload_json),
      createdAt: r.created_at
    });
  }

  items.sort(timelineSort);
  const timeline = items.length <= limit ? items : items.slice(-limit);

  return {
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    limit,
    timeline
  };
}
