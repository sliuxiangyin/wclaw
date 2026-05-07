import type { UIMessage } from "ai";
import type { PluginActivityPayload } from "../../../lib/api/ai-chat.api";
import type { PluginChatTimelineMessage } from "../../../lib/api/plugin-chat.api";

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

export function timelineToUiBootstrap(
  messages: PluginChatTimelineMessage[]
): TimelineChatBootstrapResult {
  const persistedActivitiesByAssistantMessageId: Record<string, PluginActivityPayload[]> = {};
  const out: UIMessage[] = [];

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

  for (const row of messages) {
    if (row.role === "user") {
      out.push(timelineMessageToUIMessage(row));
    } else {
      const acts = row.activities.map((x) => ({ phase: x.phase, data: x.data }));
      const um = timelineMessageToUIMessage(row);
      bumpAssistantActivities(um.id, acts);
      out.push(um);
    }
  }
  return { messages: out, persistedActivitiesByAssistantMessageId };
}

/** @deprecated 请用 timelineToUiBootstrap；保留以便临时兼容 */
export function timelineToUiMessages(items: PluginChatTimelineMessage[]): UIMessage[] {
  return timelineToUiBootstrap(items).messages;
}
