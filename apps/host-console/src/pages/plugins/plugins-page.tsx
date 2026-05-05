import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PluginConfigDrawer } from "../../features/plugins/components/plugin-config-drawer";
import { PluginGrid } from "../../features/plugins/components/plugin-grid";
import { usePluginConfig } from "../../features/plugins/hooks/use-plugin-config";
import { usePlugins } from "../../features/plugins/hooks/use-plugins";
import { Input } from "@/components/ui/input";

export function PluginsPage() {
  const navigate = useNavigate();
  const { items, loading, error, keyword, setKeyword } = usePlugins();
  const configDrawer = usePluginConfig();
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold tracking-tight">插件中心</h1>
      <p className="text-muted-foreground mt-1">基于宿主 API 实时加载插件清单。</p>

      <div className="mt-4 max-w-md">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索插件名称 / id / 类型"
        />
      </div>

      <div className="mt-4 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
        {error ? <p className="text-sm text-destructive">加载失败：{error}</p> : null}
        {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      </div>

      <div className="mt-4">
        {!loading && !error ? (
          <PluginGrid
            items={items}
            onOpenConfig={configDrawer.open}
            onEnterChat={(item) => navigate(`/chat/${item.pluginId}`)}
          />
        ) : null}
      </div>

      <PluginConfigDrawer
        plugin={configDrawer.activePlugin}
        config={configDrawer.config}
        loading={configDrawer.loading}
        saving={configDrawer.saving}
        error={configDrawer.error}
        onChange={configDrawer.updateField}
        onClose={configDrawer.close}
        onSave={async () => {
          try {
            await configDrawer.save();
            setNotice("配置已保存");
          } catch {
            // no-op: error handled in hook
          }
        }}
      />
    </main>
  );
}
