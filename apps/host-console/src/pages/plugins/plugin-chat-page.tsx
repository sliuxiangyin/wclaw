import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePluginChat } from "../../features/chat/hooks/use-plugin-chat";
import { usePluginChatTimelineBootstrap } from "../../features/chat/hooks/use-plugin-chat-timeline-bootstrap";
import { getAiChatEvents } from "../../lib/api/ai-chat.api";
import { getPlugins, type PluginListItem } from "../../lib/api/plugins.api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelLeftIcon, ShareIcon } from "lucide-react";
import Ai05 from "@/components/ai-05";
import type { PluginActivityPayload } from "@/lib/api/ai-chat.api";

function statusLabel(status: "valid" | "invalid") {
  return status === "valid" ? "有效（valid）" : "无效（invalid）";
}

function resolvePluginMode(plugin: PluginListItem): string {
  const manifest = plugin.manifest;
  if (!manifest) return "-";
  if (manifest.kind === "runtime_plugin") return "runtime_chat";
  const capabilities = (manifest.capabilities ?? {}) as Record<string, unknown>;
  if (capabilities.isolatedContext === true) return "isolated_chat";
  if (String(capabilities.commandContextWrite ?? "") === "none") return "ephemeral_no_context";
  if (capabilities.llm === true) return "ephemeral_with_context";
  return "ephemeral_no_context";
}

export function PluginChatPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const [plugins, setPlugins] = useState<PluginListItem[]>([]);
  const [loadingPlugin, setLoadingPlugin] = useState(true);
  const [pluginError, setPluginError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingPlugin(true);
      setPluginError(null);
      try {
        const data = await getPlugins();
        if (mounted) {
          setPlugins(data);
        }
      } catch (err) {
        if (mounted) {
          setPluginError(err instanceof Error ? err.message : "加载插件失败");
        }
      } finally {
        if (mounted) {
          setLoadingPlugin(false);
        }
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const plugin = useMemo(
    () => plugins.find((item) => item.pluginId === pluginId) ?? null,
    [pluginId, plugins]
  );

  if (loadingPlugin) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">正在加载插件信息...</p>
      </main>
    );
  }

  if (pluginError) {
    return (
      <main className="p-6 space-y-3">
        <p className="text-sm text-destructive">加载失败：{pluginError}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/plugins">返回插件列表</Link>
        </Button>
      </main>
    );
  }

  if (!plugin) {
    return (
      <main className="p-6 space-y-3">
        <p className="text-sm text-muted-foreground">插件不存在或已被移除。</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/plugins">返回插件列表</Link>
        </Button>
      </main>
    );
  }

  return <PluginChatContent plugin={plugin} />;
}

type PluginChatContentProps = {
  plugin: PluginListItem;
};

function PluginChatContent({ plugin }: PluginChatContentProps) {
  const { error, sessionId, sessions, loadingSessions, selectSession, refreshSessions } =
    usePluginChat(plugin);
  const chatBootstrap = usePluginChatTimelineBootstrap(plugin.pluginId, sessionId);
  const [chatSurfaceKey, setChatSurfaceKey] = useState(0);
  const [pluginActivities, setPluginActivities] = useState<PluginActivityPayload[]>([]);
  const [events, setEvents] = useState<
    Array<{
      id: number;
      type: string;
      source: "host" | "llm" | "plugin" | "tool";
      createdAt: string;
    }>
  >([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const manifest = plugin.manifest;
  const mode = resolvePluginMode(plugin);
  const isDefaultSession = sessionId === `${plugin.pluginId}:default`;
  const capabilityTags = Object.entries(manifest?.capabilities ?? {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

  useEffect(() => {
    let mounted = true;
    async function loadEvents() {
      setLoadingEvents(true);
      setEventsError(null);
      try {
        const list = await getAiChatEvents({ pluginId: plugin.pluginId, sessionId, limit: 15, offset: 0 });
        if (!mounted) return;
        setEvents(
          list.map((e) => ({
            id: e.id,
            type: e.type,
            source: e.source,
            createdAt: e.createdAt
          }))
        );
      } catch (err) {
        if (mounted) setEventsError(err instanceof Error ? err.message : "加载事件失败");
      } finally {
        if (mounted) setLoadingEvents(false);
      }
    }
    void loadEvents();
    return () => {
      mounted = false;
    };
  }, [plugin.pluginId, sessionId]);

  useEffect(() => {
    setPluginActivities([]);
  }, [sessionId]);

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader className="space-y-3">
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/plugins">返回插件列表</Link>
              </Button>
              <div>
                <CardTitle className="text-lg">{manifest?.displayName ?? plugin.pluginId}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{plugin.pluginId}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{statusLabel(plugin.status)}</Badge>
                <Badge variant="secondary">{manifest?.kind ?? "unknown"}</Badge>
                <Badge variant="outline">模式：{mode}</Badge>
                <Badge variant={isDefaultSession ? "outline" : "secondary"}>
                  当前会话：{isDefaultSession ? "默认引导会话" : "账号会话"}
                </Badge>
              </div>
              {capabilityTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {capabilityTags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardHeader>
            {manifest?.description ? (
              <CardContent>
                <p className="text-sm text-muted-foreground">{manifest.description}</p>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">会话列表</CardTitle>
              <p className="text-xs text-muted-foreground">点击切换聊天上下文</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingSessions ? <p className="text-sm text-muted-foreground">加载会话中...</p> : null}
              <div className="flex flex-col gap-2">
                {sessions.map((s) => (
                  <Button
                    key={s.sessionId}
                    type="button"
                    variant={s.sessionId === sessionId ? "default" : "outline"}
                    size="sm"
                    className="justify-start"
                    onClick={() => void selectSession(s.sessionId)}
                  >
                    {s.title}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">事件流</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setLoadingEvents(true);
                    setEventsError(null);
                    try {
                      const list = await getAiChatEvents({
                        pluginId: plugin.pluginId,
                        sessionId,
                        limit: 15,
                        offset: 0
                      });
                      setEvents(
                        list.map((e) => ({
                          id: e.id,
                          type: e.type,
                          source: e.source,
                          createdAt: e.createdAt
                        }))
                      );
                    } catch (err) {
                      setEventsError(err instanceof Error ? err.message : "加载事件失败");
                    } finally {
                      setLoadingEvents(false);
                    }
                  }}
                >
                  刷新
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">当前插件与会话的最近编排事件</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingEvents ? <p className="text-xs text-muted-foreground">加载事件中...</p> : null}
              {eventsError ? <p className="text-xs text-destructive">{eventsError}</p> : null}
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {events.map((e) => (
                  <div key={e.id} className="rounded-md border p-2">
                    <p className="text-xs font-medium">{e.type}</p>
                    <p className="text-[11px] text-muted-foreground">source: {e.source}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                      })}
                    </p>
                  </div>
                ))}
                {!loadingEvents && !eventsError && events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无事件</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </aside>

        <section className="flex h-[calc(100vh-8rem)] ">
            {error ? <p className="px-4 pt-2 text-sm text-destructive">{error}</p> : null}
            <main className="flex-1 overflow-hidden min-h-0">
              {chatBootstrap.loading ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border px-4 text-sm text-muted-foreground">
                  正在加载会话历史…
                </div>
              ) : (
                <>
                  {chatBootstrap.error ? (
                    <p className="mb-2 px-2 text-xs text-destructive">历史加载失败：{chatBootstrap.error}</p>
                  ) : null}
                  <Ai05
                    key={`${sessionId}-${chatSurfaceKey}`}
                    plugin={plugin}
                    sessionId={sessionId}
                    initialMessages={chatBootstrap.messages}
                    persistedActivitiesByAssistantMessageId={
                      chatBootstrap.persistedActivitiesByAssistantMessageId
                    }
                    pluginActivityFeed={pluginActivities}
                    onPluginActivity={(ev) => setPluginActivities((prev) => [...prev, ev])}
                    onClearPluginActivityFeed={() => setPluginActivities([])}
                    onSessionsMaybeChanged={() => void refreshSessions()}
                    onClearChatHistory={async () => {
                      await chatBootstrap.reload();
                      setPluginActivities([]);
                      setChatSurfaceKey((k) => k + 1);
                      await refreshSessions();
                    }}
                  />
                </>
              )}
            </main>
        </section>
      </div>
    </main>
  );
}
