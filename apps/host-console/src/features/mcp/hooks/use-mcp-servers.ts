import { useCallback, useEffect, useState } from "react";
import {
  deleteMcpServer,
  fetchMcpServerDetail,
  fetchMcpServerList,
  probeMcpServer,
  saveMcpServer,
  type McpServerStoredConfig,
  type McpServerSummaryDto
} from "@/lib/api/mcp.api";

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchMcpServerList();
      setServers(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const probe = useCallback(async (id: string) => {
    setError(null);
    try {
      await probeMcpServer(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
      throw e;
    }
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteMcpServer(id);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [refresh]
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setError(null);
      try {
        const detail = await fetchMcpServerDetail(id);
        const next: McpServerStoredConfig = { ...detail.config, enabled };
        await saveMcpServer(next);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [refresh]
  );

  return { servers, loading, error, refresh, probe, remove, setEnabled, setError };
}
