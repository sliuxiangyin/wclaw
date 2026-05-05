import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { PluginChatPage } from "./pages/plugins/plugin-chat-page";
import { PluginsPage } from "./pages/plugins/plugins-page";
import { LlmSettingsPage } from "./pages/settings/llm-settings-page";
import { McpServerEditorPage } from "./pages/mcp/mcp-server-editor-page";
import { McpPage } from "./pages/mcp/mcp-page";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useNotificationStream } from "./features/notifications/hooks/use-notification-stream";

export function App() {
  const { connected, lastEvent } = useNotificationStream();

  return (
    <div>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Button asChild variant="ghost">
          <NavLink
            to="/plugins"
            className={({ isActive }) => (isActive ? "bg-primary text-primary-foreground" : "")}
          >
            插件
          </NavLink>
        </Button>
        <Button asChild variant="ghost">
          <NavLink
            to="/settings/llm"
            className={({ isActive }) => (isActive ? "bg-primary text-primary-foreground" : "")}
          >
            LLM 设置
          </NavLink>
        </Button>
        <Button asChild variant="ghost">
          <NavLink
            to="/mcp"
            className={({ isActive }) => (isActive ? "bg-primary text-primary-foreground" : "")}
          >
            MCP 设置
          </NavLink>
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className={connected ? "text-emerald-600" : "text-amber-600"}>
            {connected ? "通知已连接" : "通知重连中"}
          </span>
          <span>{lastEvent ? `最近事件: ${lastEvent.type}` : "最近事件: - "}</span>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/plugins" replace />} />
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/settings/llm" element={<LlmSettingsPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/mcp/new" element={<McpServerEditorPage />} />
        <Route path="/mcp/:id" element={<McpServerEditorPage />} />
        <Route path="/chat/:pluginId" element={<PluginChatPage />} />
      </Routes>
      <Toaster position="top-center" />
    </div>
  );
}
