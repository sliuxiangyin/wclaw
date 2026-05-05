import type { PluginListItem } from "../../../lib/api/plugins.api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Props = {
  plugin: PluginListItem | null;
  config: Record<string, unknown>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
  onChange: (key: string, value: unknown) => void;
};

export function PluginConfigDrawer({
  plugin,
  config,
  loading,
  saving,
  error,
  onClose,
  onSave,
  onChange,
}: Props) {
  if (!plugin?.manifest) return null;
  const schema = plugin.manifest.configSchema;
  const properties =
    (schema?.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const keys = Object.keys(properties);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{plugin.manifest.displayName} 配置</SheetTitle>
          <SheetDescription>{plugin.pluginId}</SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-4">
          {loading ? <p className="text-sm text-muted-foreground">配置加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {!loading && keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">该插件暂无 schema 配置项。</p>
          ) : null}

          {!loading
            ? keys.map((key) => {
                const field = properties[key] ?? {};
                const type = String(field.type ?? "string");
                const title = typeof field.title === "string" ? field.title : key;
                const enumValues = (field.enum as unknown[] | undefined) ?? [];
                const current = config[key];

                return (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={`cfg-${key}`}>{title} <span className="text-xs text-muted-foreground">{key}</span></Label>
                    {enumValues.length > 0 ? (
                      <Select
                        value={String(current ?? "")}
                        onValueChange={(v) => onChange(key, v)}
                      >
                        <SelectTrigger id={`cfg-${key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {enumValues.map((v) => (
                            <SelectItem key={String(v)} value={String(v)}>
                              {String(v)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    {enumValues.length === 0 && type === "boolean" ? (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`cfg-${key}`}
                          checked={Boolean(current)}
                          onCheckedChange={(checked) => onChange(key, checked === true)}
                        />
                        <Label htmlFor={`cfg-${key}`} className="font-normal">
                          启用
                        </Label>
                      </div>
                    ) : null}
                    {enumValues.length === 0 && type === "number" ? (
                      <Input
                        id={`cfg-${key}`}
                        type="number"
                        value={typeof current === "number" ? current : Number(current ?? 0)}
                        onChange={(e) => onChange(key, Number(e.target.value))}
                      />
                    ) : null}
                    {enumValues.length === 0 && type !== "boolean" && type !== "number" ? (
                      <Input
                        id={`cfg-${key}`}
                        type="text"
                        value={String(current ?? "")}
                        onChange={(e) => onChange(key, e.target.value)}
                      />
                    ) : null}
                  </div>
                );
              })
            : null}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
