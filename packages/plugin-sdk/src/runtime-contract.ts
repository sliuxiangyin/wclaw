/**
 * runtime_plugin / command_plugin：宿主对 **`import(entry).default` 做 `new`** 后的实例类型契约。
 * 本包 **禁止** 依赖宿主、Fastify、SQLite。
 *
 * 统一约定：**仅** `executeTurn` / `executeCompleted` 作为一轮输入与编排后回流入口（见 `docs/插件/插件实例与编排.md`）。
 */

export type PluginSessionRow = {
  sessionId: string;
  updatedAt: string;
  title?: string;
  ui?: {
    subtitle?: string;
    description?: string;
    badges?: string[];
    welcome?: string;
    suggestions?: Array<{ prompt: string; text?: string }>;
    avatarUrl?: string;
    coverUrl?: string;
  };
  /** 会话持久化策略：ephemeral 表示该会话消息默认不落宿主 chat message 表 */
  persistence?: "persist" | "ephemeral";
  /** 仅 runtime_plugin 生效：true 时该会话消息无论是否命令都优先进入 executeTurn。 */
  forceExecuteTurn?: boolean;
};

/** 由宿主在 `executeTurn` 返回后统一落库；sessionId 须属于当前 pluginId */
export type PluginChatPersistRow = {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
};

/** `executeTurn` 返回值：统一对象协议。 */
export type PluginTurnHandleResult = {
  /** 本轮文本输出（必填） */
  text: string;
  /**
   * `true`：`text` 作为中间结果；在 `ephemeral_with_context` 等路径下由宿主转为 LLM 的 **user** 侧输入，不再单独流式输出为最终助手正文，再接 LLM 回复。
   * `false` 或省略：本轮 **`text` 即对用户可见的最终输出**，宿主不再接后续 LLM（`toTurnResult` 默认与此一致）。
   */
  continue?: boolean;
  /** 可选：跨会话追加落库消息 */
  persist?: PluginChatPersistRow[];
};

/** 与宿主 Hub `publish` 入参兼容的最小描述（topic 为稳定字符串）。 */
export type PluginHostPublishInput = {
  topics: readonly string[];
  notification?: Record<string, unknown>;
};

/**
 * `executeTurn` 入参：单轮编排中插件可见的最小上下文。
 * - `message`：本轮用户可见正文。
 * - `argv`：可选；宿主若已解析为「命令名 + 参数数组」，可一并传入；未传时插件仅依据 `message` 解析即可。
 */
export type PluginTurnContext = {
  sessionId: string;
  message: string;
  config: Record<string, unknown>;
  argv?: {
    command: string;
    args: string[];
  };
  emitAssistantDelta?: (delta: string) => void;
};

export type PluginScheduledTask = {
  taskId: string;
  intervalMs: number;
  jitterMs?: number;
  timeoutMs?: number;
  maxRetry?: number;
  backoff?: {
    type: "fixed" | "linear" | "exponential";
    baseMs: number;
    maxMs: number;
  };
  enabled?: boolean;
};

export type PluginScheduledTaskContext = {
  config: Record<string, unknown>;
};

export type PluginClearSessionContext = {
  sessionId: string;
  config: Record<string, unknown>;
};

/** 外部系统替用户插入一轮 user，再走与 HTTP `POST /api/ai/chat` 相同的宿主编排（见宿主实现说明）。 */
export type ExternalUserTurnInput = {
  sessionId: string;
  userText: string;
  traceId?: string;
  source?: { kind: string; ref?: string };
  metadata?: Record<string, unknown>;
  model?: string;
};

export type ExternalUserTurnResult =
  | { ok: true; sessionId: string; reply: string; mode: "normal" | "isolated" }
  | { ok: false; code: string; message: string };

/** 经宿主 MCP 网关调用工具（`toolId` 为 `serverId/toolName`）。 */
export type HostMcpInvokeInput = {
  toolId: string;
  arguments?: Record<string, unknown>;
  traceId?: string;
  /** 同一插件会话内复用 MCP 客户端（建议 `${pluginId}:${sessionId}`）。 */
  contextKey?: string;
};

export type HostMcpInvokeResult =
  | {
      ok: true;
      toolId: string;
      /** 原始工具返回对象（宿主不做格式标准化）。 */
      result: unknown;
      /** 兼容字段：某些宿主实现可能补充结构化数据。 */
      data?: unknown | null;
      /** 兼容字段：某些宿主实现可能补充文本。 */
      text?: string | null;
      /** 兼容字段：某些宿主实现可能补充原始回包别名。 */
      raw?: unknown;
    }
  | { ok: false; code: string; message: string };

export type HostMcpReleaseContextInput = {
  serverId: string;
  /** 释放指定上下文；空值表示释放该插件默认上下文。 */
  contextKey?: string;
};

export type HostMcpReleaseContextResult =
  | { ok: true; serverId: string; contextKey: string; released: boolean }
  | { ok: false; code: string; message: string };

/** 宿主 LLM 单次补全消息（与 `generateWithConfiguredLlm` 对齐的最小形状）。 */
export type HostLlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HostLlmInvokeInput = {
  messages: HostLlmMessage[];
  model?: string;
  traceId?: string;
  /** 工具策略：`none` 表示本次补全禁止工具调用（宿主侧执行约束）。 */
  toolPolicy?: "auto" | "none";
};

export type HostLlmInvokeResult =
  | { ok: true; text: string; model?: string }
  | { ok: false; code: string; message: string };

/**
 * `executeCompleted` 入参：编排落库成功后，将本轮 assistant 回流外部渠道。
 * `metadata` 与进线时 `ExternalUserTurnInput.metadata` 同源。
 */
export type PluginExecuteCompletedInput = {
  sessionId: string;
  reply: string;
  metadata?: Record<string, unknown>;
  /** 业务侧 trace（非宿主 HTTP request.id） */
  traceId?: string;
};

/** 宿主在 `new` 时传入的构造依赖。`publish` 仅为 Hub 发布窄接口。 */
export type PluginRuntimeExtensionDeps = {
  pluginId: string;
  publish: (input: PluginHostPublishInput) => void;
  /** 插件专属工作目录（绝对路径），由宿主创建，供缓存/状态/临时文件落盘。 */
  workspaceDir?: string;
  /** 可选：由宿主注入，供外部进线触发与 UI Chat 同源编排。 */
  ingestExternalUserTurn?: (input: ExternalUserTurnInput) => Promise<ExternalUserTurnResult>;
  /**
   * 可选：经宿主 MCP 网关调用工具（受 `plugin.json` 的 `mcp.allowedServers` 约束）。
   * `pluginId` 由宿主工厂闭包绑定。
   */
  invokeHostMcpTool?: (input: HostMcpInvokeInput) => Promise<HostMcpInvokeResult>;
  /** 可选：释放插件当前 MCP 上下文对应的持久客户端。 */
  releaseHostMcpContext?: (input: HostMcpReleaseContextInput) => Promise<HostMcpReleaseContextResult>;
  /**
   * 可选：经宿主配置调用 LLM 一次补全（需 `capabilities.llm === true`）。
   * `pluginId` 由宿主工厂闭包绑定；密钥与上游仍由宿主负责。
   */
  invokeHostLlm?: (input: HostLlmInvokeInput) => Promise<HostLlmInvokeResult>;
};

/**
 * `export default class` 应实现的实例能力（方法均为可选，由 `plugin.json` capabilities 驱动宿主是否调用）。
 *
 * - **一轮输入**：`executeTurn`
 * - **编排后回流**：`executeCompleted`
 * - **与会话列表 / 清会话 / 调度正交**：`decorateSessions`、`clearSession`、`getScheduledTasks`、`runScheduledTask`
 */
export type PluginRuntimeExtension = {
  executeTurn?: (ctx: PluginTurnContext) => Promise<PluginTurnHandleResult> | PluginTurnHandleResult;

  executeCompleted?: (input: PluginExecuteCompletedInput) => Promise<void> | void;

  decorateSessions?: () => PluginSessionRow[] | Promise<PluginSessionRow[]>;

  getScheduledTasks?: () => PluginScheduledTask[];

  runScheduledTask?: (taskId: string, ctx: PluginScheduledTaskContext) => Promise<void> | void;

  clearSession?: (ctx: PluginClearSessionContext) => Promise<void> | void;
};

/** 插件入口模块：`default` 为可 `new` 的类。 */
export type PluginRuntimeExtensionModule = {
  default: new (deps: PluginRuntimeExtensionDeps) => PluginRuntimeExtension;
};
