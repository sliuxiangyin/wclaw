import { PluginExecuteCompletedInput } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import type { PluginManifest, PluginObjectItem } from "../plugin-catalog/plugin-catalog.service.js";

/** 宿主编排使用的 UI 消息形状（来自路由层 JSON） */
export type UiChatMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

/** SSE / 非流式 共用的宿主侧回调 */
export type AiChatStreamCallbacks = {
  onStart?: (meta: { sourceType: "runtime" | "plugin"; sourcePluginId: string | null }) => void;
  onTextDelta?: (delta: string) => void;
  /** 透传 LLM 结构化 chunk（reasoning/tool/source 等）到 SSE */
  onLlmChunk?: (chunk: Record<string, unknown> & { type: string }) => void;
  /** 插件/MCP 活动进度：仅 SSE，不入 LLM 上下文、不写入 assistant 正文流 */
  onPluginActivity?: (payload: { phase: string; data?: Record<string, unknown> }) => void;
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
