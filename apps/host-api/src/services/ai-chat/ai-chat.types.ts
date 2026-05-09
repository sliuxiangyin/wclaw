import { PluginExecuteCompletedInput } from "@wclaw/plugin-sdk";
import type { UIMessage } from "ai";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import type { PluginManifest, PluginObjectItem } from "../plugin-catalog/plugin-catalog.service.js";

/** 宿主编排使用的 UI 消息形状（来自路由层 JSON） */
export type UiChatMessage = UIMessage & {
  role: "system" | "user" | "assistant";
  content?: string;
};

/** SSE / 非流式 共用的宿主侧回调 */
export type AiChatStreamCallbacks = {
  onStart?: (meta: { sourceType: "runtime" | "plugin"; sourcePluginId: string | null }) => void;
  onTextDelta?: (delta: string) => void;
  /** 透传 LLM 结构化 chunk（reasoning/tool/source 等）到 SSE */
  onLlmChunk?: (chunk: Record<string, unknown> & { type: string }) => void;
};

export type OrchestrateChatInput = {
  pluginRuntime: PluginRuntimePort;
  plugin?: PluginObjectItem;
  pluginId: string;
  sessionId: string;
  messages: UiChatMessage[];
  model?: string;
  traceId?: string | null;
  abortSignal?: AbortSignal;
  stream?: AiChatStreamCallbacks;
  /** 供 `executeCompleted` 与进线 `metadata` 同源（HTTP Chat 通常不传） */
  reflowMetadata?: Record<string, unknown>;
  /** 标准 UIMessage 流入口已自行持久化消息时可关闭旧文本落库适配。 */
  persistMessages?: boolean;
  /**
   * 本轮编排来源。仅 `web` 会与 `sessionConcurrency: web_fail_fast` 配合触发「同会话仅一条 Web 占线」检测。
   * 进线/ingest 使用 `external`（默认）。
   */
  turnSource?: "web" | "external";
  /**
   * `web_fail_fast`：仅当 **当前已有一条 Web 轮次正在执行** 时，新的 Web 请求立即 409；
   * `external` 进线或与 Web 交叉时仍走同会话 FIFO 队列（不 409）。
   * 默认 `queue`：仅队列、无 Web 快速失败。
   */
  sessionConcurrency?: "web_fail_fast" | "queue";
};

/** 各分支编排完成后汇总的「本轮应答元数据」（统一落 assistant 行） */
export type ChatBranchResult = {
  reply: string;
  sourceType: "runtime" | "plugin";
  sourcePluginId: string | null;
  llmEligible: boolean;
  contextSummary: string | null;
  skipSseFinalReplyChunks: boolean;
};

export type OrchestrateChatOutput = {
  pluginId: string;
  sessionId: string;
  reply: string;
  sourceType: "runtime" | "plugin";
  sourcePluginId: string | null;
  llmEligible: boolean;
  contextSummary: string | null;
  mode: "normal" | "isolated";
  isolatedPluginId: string | null;
  /** 为 true 时 SSE 已在 onTextDelta / LLM 流中写出正文，路由不再把 reply 整段再 chunk 一遍 */
  skipSseFinalReplyChunks?: boolean;
};

/** 解析 /command 后与本轮编排相关的宿主上下文快照 */
/** 隔离内或 /command 瞬时执行时，转发到 command_plugin */
export type ExecuteCommandPluginInput = {
  pluginRuntime: PluginRuntimePort;
  targetPluginId: string;
  commandText: string;
  messages: UiChatMessage[];
  model?: string;
  traceId?: string | null;
  abortSignal?: AbortSignal;
  hostPluginId: string;
  sessionId: string;
  stream?: AiChatStreamCallbacks;
};

export type AiOrchestrationContext = {
  pluginRuntime: PluginRuntimePort;
  /** 当前 Chat 宿主插件目录项（与 `pluginId` 一致），避免分支内重复 `pluginRuntime.plugin`。 */
  hostPlugin: PluginObjectItem;
  state: ChatSessionState;
  hostManifest: PluginManifest;
  pluginId: string;
  sessionId: string;
  userMessage: string;
  messages: UiChatMessage[];
  model?: string;
  traceId?: string | null;
  abortSignal?: AbortSignal;
  stream?: AiChatStreamCallbacks;
};
