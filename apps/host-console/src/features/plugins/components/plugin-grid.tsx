import type { PluginListItem } from "../../../lib/api/plugins.api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Props = {
  items: PluginListItem[];
  onOpenConfig: (item: PluginListItem) => void;
  onEnterChat: (item: PluginListItem) => void;
};

function statusLabel(status: PluginListItem["status"]) {
  return status === "valid" ? "有效（valid）" : "无效（invalid）";
}

function resolvePluginMode(item: PluginListItem): string {
  const manifest = item.manifest;
  if (!manifest) return "-";

  if (manifest.kind === "runtime_plugin") {
    return "runtime_chat";
  }

  return manifest.commandMode ?? "ephemeral_no_context";
}

export function PluginGrid({ items, onOpenConfig, onEnterChat }: Props) {
  if (items.length === 0) {
    return <p className="text-muted-foreground">暂无插件。</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const manifest = item.manifest;
        return (
          <Card key={item.pluginId}>
            <CardHeader className="pb-3">
              <CardTitle>{manifest?.displayName ?? item.pluginId}</CardTitle>
              <CardDescription>{item.pluginId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{statusLabel(item.status)}</Badge>
                <Badge variant="secondary">{manifest?.kind ?? "unknown"}</Badge>
                <Badge variant="outline">模式：{resolvePluginMode(item)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground min-h-[2.5rem]">
                {manifest?.description ?? (item.errors?.join("; ") || "无描述")}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onEnterChat(item)}>
                  进入 Chat
                </Button>
                <Button size="sm" variant="outline" onClick={() => onOpenConfig(item)} disabled={!manifest}>
                  配置
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
