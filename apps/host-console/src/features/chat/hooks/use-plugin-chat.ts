import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getPluginSessions,
  switchPluginSession,
  type PluginSessionRowDto
} from "../../../lib/api/plugin-chat.api";

import type { PluginListItem } from "../../../lib/api/plugins.api";



export function usePluginChat(plugin: PluginListItem) {

  const [sessions, setSessions] = useState<PluginSessionRowDto[]>([]);

  const [loadingSessions, setLoadingSessions] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string>("");

  const storageKey = useMemo(() => `chat:lastSession:${plugin.pluginId}`, [plugin.pluginId]);



  const loadSessions = useCallback(async () => {

    setLoadingSessions(true);

    setError(null);

    try {

      const list = await getPluginSessions(plugin.pluginId);
      
      const remembered = localStorage.getItem(storageKey);

      const picked = list.find((x) => x.sessionId === remembered)?.sessionId ?? list[0]?.sessionId ?? "";

      setSessions(list);

      setSessionId(picked);

      if (picked) {
        localStorage.setItem(storageKey, picked);
      } else {
        localStorage.removeItem(storageKey);
      }

    } catch (err) {

      setError(err instanceof Error ? err.message : "加载会话失败");

      setSessions([]);
      setSessionId("");

    } finally {

      setLoadingSessions(false);

    }

  }, [plugin.pluginId, storageKey]);



  useEffect(() => {

    void loadSessions();

  }, [loadSessions]);



  async function selectSession(nextSessionId: string) {
    if (!nextSessionId) return;

    await switchPluginSession(plugin.pluginId, nextSessionId);

    setSessionId(nextSessionId);

    localStorage.setItem(storageKey, nextSessionId);

  }



  return {

    sessionId,
    currentSession: sessions.find((s) => s.sessionId === sessionId) ?? null,

    sessions,

    loadingSessions,

    error,

    selectSession,

    refreshSessions: loadSessions

  };

}


