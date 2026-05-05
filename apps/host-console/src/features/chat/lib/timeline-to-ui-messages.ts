import type { UIMessage } from "ai";
import type { PluginActivityPayload } from "../../../lib/api/ai-chat.api";
import type {
  PluginChatTimelineItem,
  PluginChatTimelineMessage
} from "../../../lib/api/plugin-chat.api";

function assistantUiMessageId(dbRowId: number): string {
  return `hist-asst-${dbRowId}`;
}

function userUiMessageId(dbRowId: number): string {
  return `hist-user-${dbRowId}`;
}

function asAssistantMetaSource(m: PluginChatTimelineMessage): string | undefined {
  if (m.role !== "assistant") return undefined;
  return m.sourceType === "plugin" && m.sourcePluginId
    ? `plugin:${m.sourcePluginId}`
    : "runtime";
}

/** 不写 metadata.pluginActivities：`useChat` hydrate 常会丢掉自定义字段，需在 UI 侧平行索引 */
function timelineMessageToUIMessage(row: PluginChatTimelineMessage): UIMessage {
  const id = row.role === "user" ? userUiMessageId(row.id) : assistantUiMessageId(row.id);
  const md =
    row.role === "assistant"
      ? ({
          source: asAssistantMetaSource(row)
        } as Record<string, unknown>)
      : undefined;
  return {
    id,
    role: row.role,
    metadata: md,
    parts: [{ type: "text", text: row.content }]
  };
}

export type TimelineChatBootstrapResult = {
  messages: UIMessage[];
  /**
   * 每条历史 assistant 消息 id（`hist-asst-{dbRowId}`）对应的插件活动。
   */
  persistedActivitiesByAssistantMessageId: Record<string, PluginActivityPayload[]>;
};

export function pluginActivitySemanticKey(p: PluginActivityPayload): string {
  return `${p.phase}\0${JSON.stringify(p.data ?? {})}`;
}

/** 渲染前兜底：timeline + archive + stream 合并后去掉完全相同的条目 */
export function dedupePluginActivitiesForDisplay(
  acts: readonly PluginActivityPayload[]
): PluginActivityPayload[] {
  const seen = new Set<string>();
  const out: PluginActivityPayload[] = [];
  for (const a of acts) {
    const k = pluginActivitySemanticKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function timelineToUiBootstrap(items: PluginChatTimelineItem[]): TimelineChatBootstrapResult {
  const persistedActivitiesByAssistantMessageId: Record<string, PluginActivityPayload[]> = {};
  const pending: PluginActivityPayload[] = [];
  const out: UIMessage[] = [];
  /** 同一条 API 时间线里重复的 trace+seq（双写等）只保留一条 */
  const seenTraceSeq = new Set<string>();
  /** 同一 trace 内完全相同的 phase+data 只出现一次（避免误挂到两轮 assistant 时重复） */
  const seenTraceSemantic = new Set<string>();

  const bumpAssistantActivities = (assistantUiId: string, extras: PluginActivityPayload[]) => {
    if (extras.length === 0) return;
    const cur = persistedActivitiesByAssistantMessageId[assistantUiId] ?? [];
    const seenInBubble = new Set(cur.map(pluginActivitySemanticKey));
    const next: PluginActivityPayload[] = [...cur];
    for (const x of extras) {
      const k = pluginActivitySemanticKey(x);
      if (seenInBubble.has(k)) continue;
      seenInBubble.add(k);
      next.push({ ...x });
    }
    if (next.length === cur.length) return;
    persistedActivitiesByAssistantMessageId[assistantUiId] = next;
  };

  const flushPendingToLastAssistant = () => {
    if (pending.length === 0) return;
    const copy = pending.map((x) => ({ ...x }));
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].role !== "assistant") continue;
      bumpAssistantActivities(out[i].id, copy);
      pending.length = 0;
      return;
    }
    pending.length = 0;
  };

  for (const item of items) {
    if (item.kind === "plugin_activity") {
      const tKey = `${item.traceId}\0${item.seq}`;
      if (seenTraceSeq.has(tKey)) continue;
      seenTraceSeq.add(tKey);
      const semKey = `${item.traceId}\0${item.phase}\0${JSON.stringify(item.data ?? {})}`;
      if (seenTraceSemantic.has(semKey)) continue;
      seenTraceSemantic.add(semKey);
      pending.push({ phase: item.phase, data: item.data });
      continue;
    }
    const row = item;
    if (row.role === "user") {
      flushPendingToLastAssistant();
      out.push(timelineMessageToUIMessage(row));
    } else {
      const acts = pending.map((x) => ({ ...x }));
      pending.length = 0;
      const um = timelineMessageToUIMessage(row);
      bumpAssistantActivities(um.id, acts);
      out.push(um);
    }
  }
  flushPendingToLastAssistant();
  return { messages: out, persistedActivitiesByAssistantMessageId };
}

/** @deprecated 请用 timelineToUiBootstrap；保留以便临时兼容 */
export function timelineToUiMessages(items: PluginChatTimelineItem[]): UIMessage[] {
  return timelineToUiBootstrap(items).messages;
}
