import { useEffect, useState } from "react";
import { getLlmProfile, saveLlmProfile, type LlmConfig } from "../../../lib/api/llm.api";

const DEFAULT_CONFIG: LlmConfig = {
  displayName: "默认配置",
  providerType: "custom",
  baseURL: "",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: 30000,
  enableStreaming: true
};

export function useLlmConfig(scope: string) {
  const [config, setConfig] = useState<LlmConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const row = await getLlmProfile(scope);
        if (mounted) setConfig({ ...DEFAULT_CONFIG, ...row.config });
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
  }, [scope]);

  function updateField<K extends keyof LlmConfig>(key: K, value: LlmConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveLlmProfile(scope, config);
      setConfig(saved);
      setNotice("LLM 配置已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return { config, loading, saving, error, notice, updateField, save };
}
