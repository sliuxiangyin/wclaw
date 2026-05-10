import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useLlmProfiles } from "../../features/llm/hooks/use-llm-profiles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { LlmProfile } from "@/lib/api/llm.api";

function profileTitle(p: { scope: string; config: { displayName?: string } }): string {
  const name = p.config.displayName?.trim();
  if (name) return name;
  return p.scope === "global" ? "global（默认）" : p.scope;
}

export function LlmSettingsPage() {
  const { profiles, activeScope, loading, error, refresh, createAndNavigate, activate, remove } =
    useLlmProfiles();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<LlmProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const aOn = a.scope === activeScope;
      const bOn = b.scope === activeScope;
      if (aOn !== bOn) return aOn ? -1 : 1;
      return profileTitle(a).localeCompare(profileTitle(b));
    });
  }, [profiles, activeScope]);

  function toggleExpand(scope: string) {
    setExpanded((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await remove(pendingDelete.scope);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <main className="mx-auto w-full max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">LLM 配置</h1>
            <p className="mt-1 text-muted-foreground">
              管理多组模型与端点；「使用中」的配置用于控制台 AI 与宿主编排。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" onClick={() => void refresh()} className="gap-1" disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            <Button onClick={() => void createAndNavigate()} className="gap-1" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              创建配置
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {sorted.length === 0 && !loading ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              暂无配置，点击「创建配置」开始。
            </div>
          ) : (
            <div className="divide-y divide-border">
            {sorted.map((p) => {
              const active = p.scope === activeScope;
              const isExpanded = expanded[p.scope] ?? false;
              const title = profileTitle(p);
              const firstChar = title.slice(0, 1).toUpperCase();
              return (
                <div key={p.scope} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
                      {firstChar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{title}</span>
                        <span
                          className={cn(
                            "inline-block h-2 w-2 shrink-0 rounded-full",
                            active ? "bg-emerald-500" : "bg-zinc-400"
                          )}
                        />
                        {active ? (
                          <span className="shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            使用中
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                        {p.config.model ? (
                          <span className="font-mono text-foreground/80">{String(p.config.model)}</span>
                        ) : (
                          <span>未填写模型</span>
                        )}
                        {p.updatedAt ? (
                          <>
                            <span>·</span>
                            <span>更新 {p.updatedAt}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="hidden items-center gap-1 md:flex">
                      <Button variant="ghost" size="icon" title="编辑" asChild>
                        <Link to={`/settings/llm/${encodeURIComponent(p.scope)}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="删除"
                        onClick={() => setPendingDelete(p)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleExpand(p.scope)}
                      title={isExpanded ? "收起" : "展开"}
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                      />
                    </Button>
                  </div>

                  <div
                    className={cn(
                      "grid transition-all",
                      isExpanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          {!active ? (
                            <Button size="sm" variant="outline" onClick={() => void activate(p.scope)}>
                              设为使用
                            </Button>
                          ) : null}
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/settings/llm/${encodeURIComponent(p.scope)}`}>编辑表单</Link>
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setPendingDelete(p)}>
                            删除
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <div className="break-all">Scope: {p.scope}</div>
                          <div>状态: {active ? "当前对话使用该配置" : "未作为当前配置"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </main>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除此配置？</DialogTitle>
            <DialogDescription>
              {pendingDelete ? (
                <>
                  将永久删除「<span className="font-medium text-foreground">{profileTitle(pendingDelete)}</span>
                  」。正在使用的配置删除后会自动切换到其他可用项。
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
