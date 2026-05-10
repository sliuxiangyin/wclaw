import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  activateLlmProfile,
  createLlmProfile,
  deleteLlmProfile,
  listLlmProfiles,
  type LlmProfile
} from "../../../lib/api/llm.api";

export function useLlmProfiles() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [activeScope, setActiveScope] = useState<string>("global");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { profiles: list, activeScope: active } = await listLlmProfiles();
      setProfiles(list);
      setActiveScope(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createAndNavigate() {
    setError(null);
    try {
      const created = await createLlmProfile();
      await refresh();
      navigate(`/settings/llm/${encodeURIComponent(created.scope)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function activate(scope: string) {
    setError(null);
    try {
      const next = await activateLlmProfile(scope);
      setActiveScope(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败");
    }
  }

  async function remove(scope: string) {
    setError(null);
    try {
      const next = await deleteLlmProfile(scope);
      setActiveScope(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return {
    profiles,
    activeScope,
    loading,
    error,
    refresh,
    createAndNavigate,
    activate,
    remove
  };
}
