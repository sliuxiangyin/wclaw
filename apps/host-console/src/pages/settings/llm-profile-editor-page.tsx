import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useLlmConfig } from "../../features/llm/hooks/use-llm-config";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function Field({
  id,
  label,
  children,
  hint
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SectionCollapsible({
  title,
  defaultOpen,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border bg-muted/30">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="flex h-10 w-full items-center justify-between rounded-none px-3 font-medium hover:bg-muted/50"
        >
          {title}
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-border px-3 pb-3 pt-3 data-[state=closed]:animate-none">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function LlmProfileEditorPage() {
  const { scope: scopeParam } = useParams<{ scope: string }>();
  const scope = scopeParam ? decodeURIComponent(scopeParam) : "";

  const { config, loading, saving, error, notice, updateField, save } = useLlmConfig(scope);

  if (!scope) {
    return (
      <main className="mx-auto w-full max-w-5xl p-6">
        <p className="text-sm text-destructive">URL 中缺少有效的 scope。</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/settings/llm">返回列表</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">LLM 配置编辑</h1>
          <p className="mt-1 text-muted-foreground">
            修改后保存；与 MCP 设置相同，保存后再回列表切换「使用中」。
          </p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">scope: {scope}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/settings/llm">返回列表</Link>
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? "保存中..." : "保存配置"}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      </div>

      {!loading ? (
        <div className="mt-4 space-y-4">
          <div className="overflow-hidden rounded-md border border-input bg-card">
            <div className="space-y-4 p-4">
              <SectionCollapsible title="名称与连接" defaultOpen>
                <Field id="displayName" label="显示名称">
                  <Input
                    id="displayName"
                    placeholder="便于在列表中识别"
                    value={config.displayName ?? ""}
                    onChange={(e) => updateField("displayName", e.target.value)}
                  />
                </Field>
                <Field id="provider" label="Provider" hint="通常为 custom 或兼容 OpenAI 的供应商标识">
                  <Input
                    id="provider"
                    value={config.providerType}
                    onChange={(e) => updateField("providerType", e.target.value)}
                  />
                </Field>
                <Field id="baseURL" label="Base URL">
                  <Input
                    id="baseURL"
                    placeholder="https://…"
                    value={config.baseURL}
                    onChange={(e) => updateField("baseURL", e.target.value)}
                  />
                </Field>
                <Field id="apiKey" label="API Key">
                  <Input
                    id="apiKey"
                    type="password"
                    autoComplete="off"
                    value={config.apiKey}
                    onChange={(e) => updateField("apiKey", e.target.value)}
                  />
                </Field>
              </SectionCollapsible>

              <SectionCollapsible title="模型与生成参数" defaultOpen>
                <Field id="model" label="Model">
                  <Input
                    id="model"
                    placeholder="例如 gpt-4o-mini"
                    value={config.model}
                    onChange={(e) => updateField("model", e.target.value)}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="temperature" label="Temperature">
                    <Input
                      id="temperature"
                      type="number"
                      step="0.1"
                      value={config.temperature}
                      onChange={(e) => updateField("temperature", Number(e.target.value))}
                    />
                  </Field>
                  <Field id="maxTokens" label="Max tokens">
                    <Input
                      id="maxTokens"
                      type="number"
                      value={config.maxTokens}
                      onChange={(e) => updateField("maxTokens", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Field id="timeoutMs" label="超时（毫秒）">
                  <Input
                    id="timeoutMs"
                    type="number"
                    value={config.timeoutMs}
                    onChange={(e) => updateField("timeoutMs", Number(e.target.value))}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    id="enableStreaming"
                    checked={config.enableStreaming}
                    onCheckedChange={(checked) => updateField("enableStreaming", checked === true)}
                  />
                  <span>启用流式输出</span>
                </label>
              </SectionCollapsible>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
