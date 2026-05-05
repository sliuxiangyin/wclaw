import { useLlmConfig } from "../../features/llm/hooks/use-llm-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export function LlmSettingsPage() {
  const { config, loading, saving, error, notice, updateField, save } = useLlmConfig();

  return (
    <main className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">LLM 配置（Custom）</h1>
      <p className="text-muted-foreground mt-1">当前先支持自定义 provider 参数。</p>

      <div className="mt-4 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      </div>

      {!loading ? (
        <div className="mt-6 grid gap-5">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Input
              id="provider"
              value={config.providerType}
              onChange={(e) => updateField("providerType", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseURL">Base URL</Label>
            <Input
              id="baseURL"
              value={config.baseURL}
              onChange={(e) => updateField("baseURL", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={config.apiKey}
              onChange={(e) => updateField("apiKey", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              value={config.model}
              onChange={(e) => updateField("model", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="temperature">Temperature</Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              value={config.temperature}
              onChange={(e) => updateField("temperature", Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxTokens">Max Tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              value={config.maxTokens}
              onChange={(e) => updateField("maxTokens", Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeoutMs">Timeout Ms</Label>
            <Input
              id="timeoutMs"
              type="number"
              value={config.timeoutMs}
              onChange={(e) => updateField("timeoutMs", Number(e.target.value))}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="enableStreaming"
              checked={config.enableStreaming}
              onCheckedChange={(checked) => updateField("enableStreaming", checked === true)}
            />
            <Label htmlFor="enableStreaming" className="font-normal">
              启用流式输出
            </Label>
          </div>

          <div>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
