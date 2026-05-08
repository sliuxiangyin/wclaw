"use client";

import type { UIMessage } from "ai";
import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ErrorPrimitive,
  type ToolCallMessagePartStatus,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  MessagePrimitive,
  MessagePartPrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";
import { Button } from "@/components/ui/button";
import {
  Bolt,
  CheckIcon,
  ChevronDown,
  CopyIcon,
  PencilIcon,
  RefreshCw,
  Send,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import type { PluginListItem } from "@/lib/api/plugins.api";
import {
  clearPluginSessionMessages,
  type PluginSessionRowDto
} from "@/lib/api/plugin-chat.api";
import type { PluginActivityPayload } from "@/lib/api/ai-chat.api";
import {
  PluginStreamActivityProvider,
  usePluginStreamActivities
} from "@/features/chat/context/plugin-stream-activity-context";
import {
  TimelinePersistedActivitiesProvider,
  useTimelinePersistedActivities
} from "@/features/chat/context/timeline-persisted-activities-context";
import { dedupePluginActivitiesForDisplay } from "@/features/chat/lib/timeline-to-ui-messages";
import { PluginChatTransport } from "@/features/chat/runtime/plugin-chat-transport";
import { Ai05ToolPanel } from "./ai-05-tool-panel";
import { ComposerAddAttachment, ComposerAttachments } from "./assistant-ui/attachment";
import { MarkdownText } from "./assistant-ui/markdown-text";
import { PluginFallback } from "./assistant-ui/plugin-fallback";
import { ToolFallback } from "./assistant-ui/tool-fallback";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "./assistant-ui/reasoning";

/** `useAuiState` / useSyncExternalStore 要求快照引用稳定：`?? []` 每次 new 会无限循环 */
const EMPTY_PLUGIN_ACTIVITIES: readonly PluginActivityPayload[] = [];

const PluginActivityArchiveContext = createContext<Record<string, PluginActivityPayload[]>>({});

function usePluginActivityArchive() {
  return useContext(PluginActivityArchiveContext);
}

function Ai05StreamDoneArchiver({
  activityFeed,
  onCommit
}: {
  activityFeed: readonly PluginActivityPayload[];
  onCommit: (messageId: string, activities: PluginActivityPayload[]) => void;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const messages = useAuiState((s) => s.thread.messages);
  const prevRunning = useRef(false);

  useEffect(() => {
    const ended = prevRunning.current && !isRunning;
    prevRunning.current = isRunning;
    if (!ended) return;
    const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
    const acts = [...activityFeed];
    if (!lastAsst || acts.length === 0) return;
    onCommit(lastAsst.id, acts);
  }, [isRunning, messages, activityFeed, onCommit]);

  return null;
}

type ToolLikeActivity = {
  toolName: string;
  toolCallId: string;
  argsText?: string;
  result?: unknown;
  status?: ToolCallMessagePartStatus;
};

type PluginCallPart = ToolLikeActivity & {
  type: "plugin-call";
};

function toToolLikeActivity(
  ev: PluginActivityPayload,
  fallbackId: string,
): ToolLikeActivity {
  const data = ev.data;
  const toolName =
    typeof data?.toolName === "string" && data.toolName.trim() ? data.toolName.trim() : "plugin_activity";

  const toolCallId =
    typeof data?.toolCallId === "string" && data.toolCallId.trim()
      ? data.toolCallId
      : fallbackId;

  const argsText =
    typeof data?.argsText === "string"
      ? data.argsText
      : data?.input !== undefined
        ? JSON.stringify(data.input, null, 2)
        : data?.args !== undefined
          ? JSON.stringify(data.args, null, 2)
          : typeof data?.summary === "string"
            ? data.summary
          : undefined;

  const candidateStatus = data?.status as Partial<ToolCallMessagePartStatus> | undefined;
  let status: ToolCallMessagePartStatus | undefined;
  if (
    candidateStatus?.type === "complete" ||
    candidateStatus?.type === "incomplete" ||
    candidateStatus?.type === "requires-action"
  ) {
    status = candidateStatus as ToolCallMessagePartStatus;
  } else if (ev.phase === "error") {
    status = { type: "incomplete", reason: "error" };
  } else {
    status = { type: "complete" };
  }

  const result =
    data?.result !== undefined
      ? data.result
      : data?.summary !== undefined
        ? { content: [{ type: "text", text: String(data.summary) }] }
        : undefined;

  return {
    toolName,
    toolCallId,
    argsText,
    result,
    status,
  };
}

interface Ai05Props {
  plugin: PluginListItem;
  sessionId: string;
  session?: PluginSessionRowDto | null;
  /** 进入会话或切换会话时由后端 timeline 注水 */
  initialMessages?: UIMessage[];
  /** GET timeline 中 kind=plugin_activity 的平行索引（不依赖 useChat 是否保留 metadata） */
  persistedActivitiesByAssistantMessageId?: Record<string, PluginActivityPayload[]>;
  onSessionsMaybeChanged?: () => void;
  /** 当前轮次 SSE data-plugin_activity，展示在「最后一条」assistant 气泡内 */
  pluginActivityFeed?: PluginActivityPayload[];
  onPluginActivity?: (payload: PluginActivityPayload) => void;
  onActivityStreamReset?: () => void;
  /** 一轮 SSE 结束时将插件活动归档到气泡后清空 feed（不要用 onActivityStreamReset 清 feed） */
  onClearPluginActivityFeed?: () => void;
  /** 宿主库消息已清空后调用：由页面侧重新拉 timeline、刷新会话列表等 */
  onClearChatHistory?: () => Promise<void>;
  title?: string;
  subtitle?: string;
  statusText?: string;
  welcomeMessage?: string;
  suggestions?: Array<{ prompt: string; text?: string }>;
}

export default function Ai05({
  plugin,
  sessionId,
  session,
  initialMessages,
  persistedActivitiesByAssistantMessageId,
  onSessionsMaybeChanged,
  pluginActivityFeed = [],
  onPluginActivity,
  onActivityStreamReset,
  onClearPluginActivityFeed,
  onClearChatHistory,
  title,
  subtitle,
  statusText,
  welcomeMessage,
  suggestions,
}: Ai05Props) {
  const [archivedActivitiesByMessageId, setArchivedActivitiesByMessageId] = useState<
    Record<string, PluginActivityPayload[]>
  >({});
  const [clearingMessages, setClearingMessages] = useState(false);

  useEffect(() => {
    setArchivedActivitiesByMessageId({});
  }, [sessionId]);

  const handleCommitStreamActivities = useCallback(
    (messageId: string, activities: PluginActivityPayload[]) => {
      setArchivedActivitiesByMessageId((m) => ({ ...m, [messageId]: activities }));
      onClearPluginActivityFeed?.();
    },
    [onClearPluginActivityFeed]
  );

  const transport = useMemo(
    () =>
      new PluginChatTransport({
        pluginId: plugin.pluginId,
        sessionId,
        onSessionsMaybeChanged,
        onPluginActivity,
        onActivityStreamReset
      }),
    [plugin.pluginId, sessionId, onSessionsMaybeChanged, onPluginActivity, onActivityStreamReset]
  );

  const runtime = useChatRuntime({ transport, messages: initialMessages ?? [] });

  const manifest = plugin.manifest;
  const displayTitle = title ?? manifest?.displayName ?? plugin.pluginId;
  const displaySubtitle = subtitle ?? ` ${plugin.pluginId}`;
  const displayStatus = statusText ?? "Live";
  const allowedServerIds = manifest?.mcp?.allowedServers ?? [];
  const canClearMessages = typeof onClearChatHistory === "function";

  const handleClearMessages = useCallback(async () => {
    // if (!canClearMessages || clearingMessages) return;
    const ok = window.confirm("确定清空当前会话在宿主内的全部聊天记录？此操作不可恢复。");
    if (!ok) return;
    setClearingMessages(true);
    try {
      runtime.thread.cancelRun();
      await clearPluginSessionMessages(plugin.pluginId, sessionId);
      await onClearChatHistory?.();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "清空消息失败");
    } finally {
      setClearingMessages(false);
    }
  }, [
    canClearMessages,
    clearingMessages,
    onClearChatHistory,
    plugin.pluginId,
    sessionId,
    runtime.thread
  ]);

  const displayWelcome = welcomeMessage ?? session?.ui?.welcome;
  const displaySuggestions = suggestions ?? session?.ui?.suggestions ?? [];
  const showWelcomeBlock = Boolean(displayWelcome) || displaySuggestions.length > 0;

  const archiveCtxValue = useMemo(() => archivedActivitiesByMessageId, [archivedActivitiesByMessageId]);

  const timelinePersistedValue = useMemo(
    () => persistedActivitiesByAssistantMessageId ?? {},
    [persistedActivitiesByAssistantMessageId]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TimelinePersistedActivitiesProvider value={timelinePersistedValue}>
        <PluginActivityArchiveContext.Provider value={archiveCtxValue}>
          <PluginStreamActivityProvider activities={pluginActivityFeed}>
            <Ai05StreamDoneArchiver
              activityFeed={pluginActivityFeed}
              onCommit={handleCommitStreamActivities}
            />
            <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              {/* Header */}
              <header className="flex items-center justify-between gap-4 border-b border-border/80 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-balance text-sm font-semibold">
                      {displayTitle}
                    </div>
                    <div className="flex items-center gap-2 text-pretty text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {displayStatus}
                      </span>
                      <span className="hidden sm:inline">- {displaySubtitle}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label="Refresh"
                    title="Refresh"
                    onClick={() => {
                      runtime.thread.cancelRun();
                    }}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 px-2 text-muted-foreground hover:text-foreground"
                    aria-label="清空消息"
                    title="清空当前会话在宿主内的全部聊天记录（不可恢复）"
                    onClick={() => void handleClearMessages()}
                  >
                    <Trash2 className="size-4 shrink-0" />

                  </Button>
                </div>
              </header>

              {/* Conversation area */}
              <div className="relative flex flex-1 flex-col overflow-hidden bg-muted/30">
                <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-6 px-4 py-4">
                    {/* Welcome message */}
                    {showWelcomeBlock ? (
                      <ThreadPrimitive.If empty={true}>
                        <div className="flex w-full justify-start">
                          <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3">
                            {displayWelcome ? (
                              <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayWelcome}</p>
                            ) : null}
                            {displaySuggestions.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {displaySuggestions.map((s, idx) => (
                                  <ThreadPrimitive.Suggestion
                                    key={idx}
                                    prompt={s.prompt}
                                    method="replace"
                                    autoSend={true}
                                    className="inline-flex cursor-pointer items-center rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted"
                                  >
                                    {s.text ?? s.prompt}
                                  </ThreadPrimitive.Suggestion>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </ThreadPrimitive.If>
                    ) : null}

                    {/* Messages */}
                    <ThreadPrimitive.Messages
                      components={{
                        UserMessage: Ai05UserMessage,
                        AssistantMessage: Ai05AssistantMessage,
                      }}
                    />
                  </div>
                </ThreadPrimitive.Viewport>

                <ThreadPrimitive.ScrollToBottom asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute bottom-4 right-6 z-10 size-9 rounded-full border border-border bg-background shadow-md hover:bg-muted"
                    aria-label="滚动到底部"
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </Button>
                </ThreadPrimitive.ScrollToBottom>
              </div>



              {/* Prompt Input - 使用原生 textarea 避免 ComposerPrimitive.Input 的 composition 问题 */}
              <Ai05Composer
                pluginId={plugin.pluginId}
                sessionId={sessionId}
                allowedServerIds={allowedServerIds}
              />
            </div>
          </PluginStreamActivityProvider>
        </PluginActivityArchiveContext.Provider>
      </TimelinePersistedActivitiesProvider>
    </AssistantRuntimeProvider>
  );
}

function Ai05Composer({
  pluginId,
  sessionId,
  allowedServerIds
}: {
  pluginId: string;
  sessionId: string;
  allowedServerIds: string[];
}) {
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEmpty = !text.trim();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      if (isEmpty || isRunning) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      aui.composer().setText(trimmed);
      aui.composer().send();
      setText("");
    },
    [aui, isEmpty, isRunning, text]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (isEmpty || isRunning) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      aui.composer().setText(trimmed);
      aui.composer().send();
      setText("");
    },
    [aui, isEmpty, isRunning, text]
  );

  return (
    <div className="bg-background">
      <ComposerPrimitive.Root onSubmit={handleSubmit}>
        <div className="relative flex flex-col border-t border-border/80">
          <Ai05ToolPanel
            pluginId={pluginId}
            sessionId={sessionId}
            allowedServerIds={allowedServerIds}
            show={showToolPanel}
            onClose={() => setShowToolPanel(false)}
          />
          <div className="px-4 pt-2">
            <ComposerAttachments />
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="发送消息.... (@ 表示提及，/ 表示命令)"
            rows={1}
            className="min-h-[60px] w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
            disabled={false}
          />
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-1">
              <ComposerAddAttachment />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label="Quick prompt"
              >
                <Bolt className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label="工具使用面板"
                title="工具使用面板"
                onClick={() => setShowToolPanel((prev) => !prev)}
              >
                <Wrench className="size-4" />
              </Button>
            </div>
            {isRunning ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-1 px-3 text-muted-foreground hover:text-foreground"
                aria-label="停止"
                title="停止当前生成"
                onClick={() => aui.thread().cancelRun()}
              >
                <X className="size-4 shrink-0" aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                variant="default"
                className="h-8 gap-1 px-3"
                aria-label="发送"
                disabled={isEmpty}
              >
                <Send className="size-4 shrink-0" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}

function Ai05UserMessage() {
  return (
    <MessagePrimitive.Root className="group flex w-full flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-primary-foreground">
        <MessagePrimitive.Content
          components={{
            Text: () => {
              return (
                <p className="whitespace-pre-wrap text-sm text-pretty">
                  <MessagePartPrimitive.Text />
                </p>
              );
            },
          }}
        />
      </div>
      {/* <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="never"
        className="flex gap-0.5"
      >
        <ActionBarPrimitive.Edit className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <PencilIcon className="size-4" />
        </ActionBarPrimitive.Edit>
      </ActionBarPrimitive.Root> */}
    </MessagePrimitive.Root>
  );
}

function Ai05AssistantMessage() {
  const streamActs = usePluginStreamActivities();
  const archiveMap = usePluginActivityArchive();
  const timelinePersistedMap = useTimelinePersistedActivities();

  const messageId = useAuiState((s) => s.message.id);


  /** useChat hydrate 常会丢 metadata.pluginActivities；仅当平行表无数据时兜底 */
  const metaPluginActs = useAuiState((s) => {
    const meta = s.message.metadata as { pluginActivities?: PluginActivityPayload[] } | undefined;
    const p = meta?.pluginActivities;
    return p ?? EMPTY_PLUGIN_ACTIVITIES;
  });

  const timelineActs = timelinePersistedMap[messageId] ?? EMPTY_PLUGIN_ACTIVITIES;
  const archivedActs = archiveMap[messageId] ?? EMPTY_PLUGIN_ACTIVITIES;

  const historyActs = timelineActs.length > 0 ? timelineActs : metaPluginActs;

  const isLastAssistant = useAuiState(
    (s) => s.message.role === "assistant" && s.message.index === s.thread.messages.length - 1
  );
  const isThreadRunning = useAuiState((s) => s.thread.isRunning);
  const hasMessageText = useAuiState((s) => {
    const content = s.message.content as unknown;
    if (typeof content === "string") return content.trim().length > 0;
    if (!Array.isArray(content)) return false;
    return content.some((part) => {
      if (typeof part === "string") return part.trim().length > 0;
      if (!part || typeof part !== "object") return false;
      const maybeText = (part as { text?: unknown }).text;
      return typeof maybeText === "string" && maybeText.trim().length > 0;
    });
  });
  const showTypingDots = isLastAssistant && isThreadRunning && !hasMessageText;

  const baseActs = [...historyActs, ...archivedActs];
  const mergedActsRaw =
    isLastAssistant && streamActs.length > 0 ? [...baseActs, ...streamActs] : baseActs;
  const mergedActs = dedupePluginActivitiesForDisplay(mergedActsRaw);
  const pluginCallParts: PluginCallPart[] = mergedActs
    .map((ev, i) => {
      const mapped = toToolLikeActivity(ev, `plugin-activity-${i}`);
      return {
        type: "plugin-call" as const,
        ...mapped,
        argsText: mapped.argsText ?? "",
      };
    });



  return (
    <MessagePrimitive.Root className="group flex w-full flex-col items-start gap-1">
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3">
        {/*
          插件活动 / 来源 不能放在 Text 组件内：流式时助手消息常为 content: []，
          assistant-ui 走 Empty 槽而非 Text，会导致整块（含 plugin_activity）不渲染。
        */}
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            if (part.type === "reasoning") return ["group-reasoning"];
            return null;
          }}
        >
          {({ part, children }) => {
            if (part.type === "group-reasoning") {
              const running = part.status.type === "running";
              return (
                <ReasoningRoot defaultOpen={running}>
                  <ReasoningTrigger active={running} />
                  <ReasoningContent aria-busy={running}>
                    <ReasoningText>{children}</ReasoningText>
                  </ReasoningContent>
                </ReasoningRoot>
              );
            }
            if (part.type === "text") {
              return showTypingDots ? <Ai05TypingDots /> : <MarkdownText />;
            }
            if (part.type === "reasoning") {
              return <Reasoning />;
            }
            if (part.type === "tool-call") {
              const toolUI = (part as { toolUI?: unknown }).toolUI;
              return toolUI ? (toolUI as ReactElement) : <ToolFallback {...part} />;
            }
            if (part.type === "data") {
              return (
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
                  {JSON.stringify(part.data, null, 2)}
                </pre>
              );
            }
            return null;
          }}
        </MessagePrimitive.GroupedParts>
      
        {pluginCallParts.length > 0 ? (
          <div className="mt-3 border-t border-border/60 pt-2">
            <div className="space-y-1.5">
              {pluginCallParts.map((part, i) => (
                <div key={`plugin-call-${part.toolCallId}-${i}`} className="bg-background/80">
                  <PluginFallback {...part} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <ErrorPrimitive.Root>
        <ErrorPrimitive.Message />
      </ErrorPrimitive.Root>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="never"
        className="flex gap-0.5"
      >
        <ActionBarPrimitive.Copy className="group/copy flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <CopyIcon className="size-4 group-data-[copied]/copy:hidden" />
          <CheckIcon className="hidden size-4 group-data-[copied]/copy:block" />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <RefreshCw className="size-4" />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function Ai05TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground" aria-label="正在生成">
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}
