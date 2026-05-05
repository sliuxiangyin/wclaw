import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMcpServers } from "@/features/mcp/hooks/use-mcp-servers";
import { McpServerToolsPopover } from "@/features/mcp/components/mcp-server-tools-popover";
import { cn } from "@/lib/utils";

export function McpPage() {
  const navigate = useNavigate();
  const { servers, loading, error, refresh, probe, remove, setEnabled } = useMcpServers();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sorted = useMemo(
    () =>
      [...servers].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.id.localeCompare(b.id);
      }),
    [servers]
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <main className="mx-auto w-full max-w-5xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP 设置</h1>
          <p className="text-muted-foreground mt-1">管理宿主 MCP Servers，支持 stdio / http。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void refresh()} className="gap-1">
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button onClick={() => navigate("/mcp/new")} className="gap-1">
            <Plus className="h-4 w-4" />
            New MCP Server
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {sorted.map((item) => {
            const isExpanded = expanded[item.id] ?? false;
            const title = item.displayName || item.id;
            const firstChar = title.slice(0, 1).toUpperCase();
            return (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-sm font-semibold">
                    {firstChar}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{title}</span>
                      <span
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          item.status.ok ? "bg-emerald-500" : "bg-zinc-400"
                        )}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                      <span>{item.transport}</span>
                      <span>·</span>
                      <McpServerToolsPopover item={item} />
                    </div>
                  </div>
                  <div className="hidden items-center gap-1 md:flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="编辑"
                      onClick={() => navigate(`/settings/mcp/${item.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除"
                      onClick={() => void remove(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <label className="mr-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={item.enabled}
                      onCheckedChange={(checked) => void setEnabled(item.id, checked === true)}
                    />
                    启用
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleExpand(item.id)}
                    title={isExpanded ? "收起" : "展开"}
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                  </Button>
                </div>

                <div className={cn("grid transition-all", isExpanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="overflow-hidden">
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void probe(item.id)} disabled={!item.enabled}>
                          探测工具
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => navigate(`/settings/mcp/${item.id}`)}>
                          编辑 JSON
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void remove(item.id)}>
                          删除
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <div>ID: {item.id}</div>
                        <div>状态: {item.status.ok ? "在线" : "离线"}</div>
                        {item.status.errorMessage ? <div>错误: {item.status.errorMessage}</div> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
