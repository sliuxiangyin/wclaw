import { useState } from "react";
import type { PluginListItem } from "../../../lib/api/plugins.api";
import { getPluginConfig, savePluginConfig, validatePluginConfig } from "../../../lib/api/plugins.api";

export function usePluginConfig() {
  const [activePlugin, setActivePlugin] = useState<PluginListItem | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(plugin: PluginListItem) {
    if (!plugin.manifest) return;
    setActivePlugin(plugin);
    setLoading(true);
    setError(null);
    try {
      const remote = await getPluginConfig(plugin.pluginId);
      const base = plugin.manifest.defaultConfig ?? {};
      setConfig({ ...base, ...remote });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置失败");
      setConfig(plugin.manifest.defaultConfig ?? {});
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setActivePlugin(null);
    setConfig({});
    setError(null);
  }

  function updateField(key: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!activePlugin?.manifest) return;
    setSaving(true);
    setError(null);
    try {
      const check = await validatePluginConfig(activePlugin.pluginId, config);
      if (!check.valid) {
        throw new Error(check.errors.join("; ") || "配置校验失败");
      }
      await savePluginConfig(activePlugin.pluginId, config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  return {
    activePlugin,
    config,
    loading,
    saving,
    error,
    open,
    close,
    updateField,
    save
  };
}
