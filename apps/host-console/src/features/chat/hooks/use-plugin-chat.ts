import { useCallback, useEffect, useMemo, useState } from "react";

import { getPluginSessions, switchPluginSession } from "../../../lib/api/plugin-chat.api";

import type { PluginListItem } from "../../../lib/api/plugins.api";



export function usePluginChat(plugin: PluginListItem) {

  const [sessions, setSessions] = useState<Array<{ sessionId: string; title: string; updatedAt: string }>>([]);

  const [loadingSessions, setLoadingSessions] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string>(`${plugin.pluginId}:default`);

  const storageKey = useMemo(() => `chat:lastSession:${plugin.pluginId}`, [plugin.pluginId]);



  const loadSessions = useCallback(async () => {

    setLoadingSessions(true);

    setError(null);

    try {

      const list = await getPluginSessions(plugin.pluginId);

      const remembered = localStorage.getItem(storageKey);

      const picked =

        list.find((x) => x.sessionId === remembered)?.sessionId ??

        list[0]?.sessionId ??

        `${plugin.pluginId}:default`;

      setSessions(list);

      setSessionId(picked);

      localStorage.setItem(storageKey, picked);

    } catch (err) {

      setError(err instanceof Error ? err.message : "加载会话失败");

      const fallback = `${plugin.pluginId}:default`;

      setSessions([{ sessionId: fallback, title: "默认会话", updatedAt: new Date().toISOString() }]);

      setSessionId(fallback);

    } finally {

      setLoadingSessions(false);

    }

  }, [plugin.pluginId, storageKey]);



  useEffect(() => {

    void loadSessions();

  }, [loadSessions]);



  async function selectSession(nextSessionId: string) {

    await switchPluginSession(plugin.pluginId, nextSessionId);

    setSessionId(nextSessionId);

    localStorage.setItem(storageKey, nextSessionId);

  }



  return {

    sessionId,

    sessions,

    loadingSessions,

    error,

    selectSession,

    refreshSessions: loadSessions

  };

}


