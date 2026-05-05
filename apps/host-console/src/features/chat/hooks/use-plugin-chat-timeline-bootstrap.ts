import type { UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import type { PluginActivityPayload } from "../../../lib/api/ai-chat.api";
import { getPluginChatHistoryTimeline } from "../../../lib/api/plugin-chat.api";
import {
  CHAT_SESSION_UPDATED_EVENT,
  type ChatSessionUpdatedDetail
} from "../lib/chat-host-events";
import { timelineToUiBootstrap } from "../lib/timeline-to-ui-messages";

export type PluginChatBootstrapState = {
  loading: boolean;
  error: string | null;
  messages: UIMessage[];
  persistedActivitiesByAssistantMessageId: Record<string, PluginActivityPayload[]>;
};

/**
 * 会话切换时拉 GET .../messages 合并 timeline，供 useChatRuntime initial messages。
 */
export function usePluginChatTimelineBootstrap(pluginId: string, sessionId: string) {
  const [state, setState] = useState<PluginChatBootstrapState>({
    loading: true,
    error: null,
    messages: [],
    persistedActivitiesByAssistantMessageId: {}
  });

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await getPluginChatHistoryTimeline(pluginId, sessionId, 200);
      const boot = timelineToUiBootstrap(data.timeline);
      setState({
        loading: false,
        error: null,
        messages: boot.messages,
        persistedActivitiesByAssistantMessageId: boot.persistedActivitiesByAssistantMessageId
      });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "加载历史失败",
        messages: [],
        persistedActivitiesByAssistantMessageId: {}
      });
    }
  }, [pluginId, sessionId]);

  useEffect(() => {
    let cancel = false;
    setState({
      loading: true,
      error: null,
      messages: [],
      persistedActivitiesByAssistantMessageId: {}
    });
    void (async () => {
      try {
        const data = await getPluginChatHistoryTimeline(pluginId, sessionId, 200);
        if (cancel) return;
        const boot = timelineToUiBootstrap(data.timeline);
        setState({
          loading: false,
          error: null,
          messages: boot.messages,
          persistedActivitiesByAssistantMessageId: boot.persistedActivitiesByAssistantMessageId
        });
      } catch (err) {
        if (cancel) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "加载历史失败",
          messages: [],
          persistedActivitiesByAssistantMessageId: {}
        });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [pluginId, sessionId]);

  useEffect(() => {
    const onSessionUpdated = (ev: Event) => {
      const ce = ev as CustomEvent<ChatSessionUpdatedDetail>;
      const d = ce.detail;
      if (!d || d.pluginId !== pluginId || d.sessionId !== sessionId) return;
      void reload();
    };
    window.addEventListener(CHAT_SESSION_UPDATED_EVENT, onSessionUpdated as EventListener);
    return () => {
      window.removeEventListener(CHAT_SESSION_UPDATED_EVENT, onSessionUpdated as EventListener);
    };
  }, [pluginId, sessionId, reload]);

  return { ...state, reload };
}
