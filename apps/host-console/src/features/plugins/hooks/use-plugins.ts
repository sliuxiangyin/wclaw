import { useEffect, useMemo, useState } from "react";
import { getPlugins, type PluginListItem } from "../../../lib/api/plugins.api";

export function usePlugins() {
  const [items, setItems] = useState<PluginListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getPlugins();
        if (mounted) setItems(data);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const name = item.manifest?.displayName?.toLowerCase() ?? "";
      const id = item.pluginId.toLowerCase();
      const kind = item.manifest?.kind?.toLowerCase() ?? "";
      return name.includes(q) || id.includes(q) || kind.includes(q);
    });
  }, [items, keyword]);

  return {
    loading,
    error,
    keyword,
    setKeyword,
    items: filtered
  };
}
