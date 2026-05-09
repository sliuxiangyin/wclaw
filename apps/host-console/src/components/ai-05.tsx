"use client";

import type { UIMessage } from "ai";
import {
  type ReactElement,
  useCallback,
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
  cancelAiChatRun,
  clearPluginSessionMessages,
  type PluginSessionRowDto
} from "@/lib/api/plugin-chat.api";
import { PluginChatTransport } from "@/features/chat/runtime/plugin-chat-transport";
import { Ai05ToolPanel } from "./ai-05-tool-panel";
import { ComposerAddAttachment, ComposerAttachments } from "./assistant-ui/attachment";
import { MarkdownText } from "./assistant-ui/markdown-text";
import { ToolFallback } from "./assistant-ui/tool-fallback";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "./assistant-ui/reasoning";

interface Ai05Props {
  plugin: PluginListItem;
  sessionId: string;
  session?: PluginSessionRowDto | null;
  /** 进入会话或切换会话时由后端 timeline 注水 */
  initialMessages?: UIMessage[];
  onSessionsMaybeChanged?: () => void;
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
  onSessionsMaybeChanged,
  onClearChatHistory,
  title,
  subtitle,
  statusText,
  welcomeMessage,
  suggestions,
}: Ai05Props) {
  const [clearingMessages, setClearingMessages] = useState(false);

  const transport = useMemo(
    () =>
      new PluginChatTransport({
        pluginId: plugin.pluginId,
        sessionId,
        onSessionsMaybeChanged
      }),
    [plugin.pluginId, sessionId, onSessionsMaybeChanged]
  );

  const runtime = useChatRuntime({
    transport: transport as never,
    messages: initialMessages ?? [],
    onFinish: () => {
      onSessionsMaybeChanged?.();
    }
  });

  const manifest = plugin.manifest;
  const displayTitle = title ?? manifest?.displayName ?? plugin.pluginId;
  const displaySubtitle = subtitle ?? ` ${plugin.pluginId}`;
  const displayStatus = statusText ?? "Live";
  const allowedServerIds = manifest?.mcp?.allowedServers ?? [];
  const canClearMessages = typeof onClearChatHistory === "function";

  const handleCancelRun = useCallback(async () => {
    try {
      await cancelAiChatRun(plugin.pluginId, sessionId);
    } catch {
      // 本地取消仍要执行，避免 UI 卡在 running。
    } finally {
      runtime.thread.cancelRun();
      onSessionsMaybeChanged?.();
    }
  }, [onSessionsMaybeChanged, plugin.pluginId, runtime.thread, sessionId]);

  const handleClearMessages = useCallback(async () => {
    // if (!canClearMessages || clearingMessages) return;
    const ok = window.confirm("确定清空当前会话在宿主内的全部聊天记录？此操作不可恢复。");
    if (!ok) return;
    setClearingMessages(true);
    try {
      await handleCancelRun();
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
    handleCancelRun,
    onClearChatHistory,
    plugin.pluginId,
    sessionId
  ]);

  const displayWelcome = welcomeMessage ?? session?.ui?.welcome;
  const displaySuggestions = suggestions ?? session?.ui?.suggestions ?? [];
  const showWelcomeBlock = Boolean(displayWelcome) || displaySuggestions.length > 0;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
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
                      onSessionsMaybeChanged?.();
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
                onCancelRun={handleCancelRun}
              />
            </div>
    </AssistantRuntimeProvider>
  );
}

function Ai05Composer({
  pluginId,
  sessionId,
  allowedServerIds,
  onCancelRun
}: {
  pluginId: string;
  sessionId: string;
  allowedServerIds: string[];
  onCancelRun: () => Promise<void>;
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
                onClick={() => void onCancelRun()}
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
    
    </MessagePrimitive.Root>
  );
}

function Ai05ToolLikeFallbackPart({ part }: { part: unknown }) {
  const rec = part as Record<string, unknown>;
  const kind = typeof rec.type === "string" ? rec.type : "";
  if (kind === "dynamic-tool" || kind.startsWith("tool-")) {
    const state = typeof rec.state === "string" ? rec.state : "input-available";
    const hasOutputError = isToolOutputError(rec.output);
    const status: ToolCallMessagePartStatus =
      state === "output-available"
        ? hasOutputError
          ? {
              type: "incomplete",
              reason: "error",
              error: "tool returned isError=true"
            }
          : { type: "complete" }
        : state === "output-error"
          ? {
              type: "incomplete",
              reason: "error",
              error: typeof rec.errorText === "string" ? rec.errorText : undefined
            }
          : state === "input-available"
            ? { type: "running" }
            : { type: "running" };
    const resultSummary = summarizeToolResultForDisplay(rec.output ?? rec.result, rec.errorText);
    return (
      <ToolFallback
        toolName={
          typeof rec.toolName === "string" && rec.toolName.trim().length > 0
            ? rec.toolName
            : kind.startsWith("tool-")
              ? kind.slice("tool-".length)
              : "unknown_tool"
        }
        result={resultSummary}
        status={status}
      />
    );
  }
  const toolUI = rec.toolUI;
  if (toolUI) return toolUI as ReactElement;
  const resultSummary = summarizeToolResultForDisplay(rec.result);
  const fallbackStatus = rec.status as ToolCallMessagePartStatus | undefined;
  const status: ToolCallMessagePartStatus | undefined =
    isToolOutputError(rec.result) && (!fallbackStatus || fallbackStatus.type === "complete")
      ? {
          type: "incomplete",
          reason: "error",
          error: "tool returned isError=true"
        }
      : fallbackStatus;
  return (
    <ToolFallback
      toolName={
        typeof rec.toolName === "string" && rec.toolName.trim().length > 0 ? rec.toolName : "unknown_tool"
      }
      result={resultSummary}
      status={status}
    />
  );
}

function isToolOutputError(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  return (output as { isError?: unknown }).isError === true;
}

function summarizeToolResultForDisplay(output: unknown, errorText?: unknown): string | undefined {
  if (typeof errorText === "string" && errorText.trim().length > 0) {
    return truncateForToolDisplay(errorText.trim(), 180);
  }
  if (typeof output === "string" && output.trim().length > 0) {
    return truncateForToolDisplay(output.trim(), 180);
  }
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const rec = output as Record<string, unknown>;
  if (Array.isArray(rec.content) && rec.content.length > 0) {
    const first = rec.content[0];
    if (first && typeof first === "object" && !Array.isArray(first) && typeof (first as { text?: unknown }).text === "string") {
      return truncateForToolDisplay((first as { text: string }).text, 180);
    }
  }
  const brief: Record<string, unknown> = {};
  if (typeof rec.isError === "boolean") brief.isError = rec.isError;
  if (typeof rec.title === "string") brief.title = rec.title;
  if (typeof rec.url === "string") brief.url = rec.url;
  if (Object.keys(brief).length > 0) {
    return truncateForToolDisplay(JSON.stringify(brief), 180);
  }
  return undefined;
}

function truncateForToolDisplay(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function Ai05AssistantMessage() {
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

  return (
    <MessagePrimitive.Root className="group flex w-full flex-col items-start gap-1">
      <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3">
        <MessagePrimitive.GroupedParts
          groupBy={(part) => {
            if (part.type === "reasoning") return ["group-reasoning"];
            return null;
          }}
        >
          {({ part, children }) => {
            const pr = part as { type?: string; status?: ToolCallMessagePartStatus; toolUI?: unknown; data?: unknown };
            const kind = typeof pr.type === "string" ? pr.type : "";
            if (kind === "group-reasoning") {
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
            if (kind === "text") {
              return showTypingDots ? <Ai05TypingDots /> : <MarkdownText />;
            }
            if (kind === "reasoning") {
              return <Reasoning />;
            }
            if (kind === "tool-call" || kind === "dynamic-tool" || kind.startsWith("tool-")) {
              return <Ai05ToolLikeFallbackPart part={part} />;
            }
            if (kind === "data") {
              return (
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-background/80 px-2 py-1.5 text-xs text-muted-foreground">
                  {JSON.stringify(pr.data, null, 2)}
                </pre>
              );
            }
            return null;
          }}
        </MessagePrimitive.GroupedParts>
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
