import type { UIMessage } from "ai";
import { useCallback, useEffect, useState } from "react";
import { getPluginChatHistoryTimeline } from "../../../lib/api/plugin-chat.api";
import {
  CHAT_SESSION_UPDATED_EVENT,
  type ChatSessionUpdatedDetail
} from "../lib/chat-host-events";

export type PluginChatBootstrapState = {
  loading: boolean;
  error: string | null;
  messages: UIMessage[];
};

/**
 * 会话切换时拉 GET .../messages 合并 timeline，供 useChatRuntime initial messages。
 */
export function usePluginChatTimelineBootstrap(pluginId: string, sessionId: string) {
  const [state, setState] = useState<PluginChatBootstrapState>({
    loading: true,
    error: null,
    messages: []
  });

  const reload = useCallback(async () => {
    if (!sessionId) {
      setState({
        loading: false,
        error: null,
        messages: []
      });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await getPluginChatHistoryTimeline(pluginId, sessionId, 200);
      setState({
        loading: false,
        error: null,
        messages: data.messages
      });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "加载历史失败",
        messages: []
      });
    }
  }, [pluginId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setState({
        loading: false,
        error: null,
        messages: []
      });
      return;
    }
    let cancel = false;
    setState({
      loading: true,
      error: null,
      messages: []
    });
    void (async () => {
      try {
        const data = await getPluginChatHistoryTimeline(pluginId, sessionId, 200);
        if (cancel) return;
        setState({
          loading: false,
          error: null,
          messages: data.messages
        });
      } catch (err) {
        if (cancel) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "加载历史失败",
          messages: []
        });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [pluginId, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
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
