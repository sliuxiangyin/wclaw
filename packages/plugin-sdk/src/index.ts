/**
 * @wclaw/plugin-sdk 对外入口：宿主与插件共用的类型契约与少量工具。
 *
 * 分组说明见下方各段注释。
 */

/** 运行时契约（插件实例、`executeTurn`、编排回流、会话行、调度等）——类型-only，无运行时代码 */
export type {
  ExternalUserTurnInput,
  ExternalUserTurnResult,
  HostLlmInvokeInput,
  HostLlmInvokeResult,
  HostLlmMessage,
  HostMcpInvokeInput,
  HostMcpInvokeResult,
  HostMcpReleaseContextInput,
  HostMcpReleaseContextResult,
  PluginChatPersistRow,
  PluginClearSessionContext,
  PluginExecuteCompletedInput,
  PluginHostPublishInput,
  PluginRuntimeExtension,
  PluginRuntimeExtensionDeps,
  PluginRuntimeExtensionModule,
  PluginScheduledTask,
  PluginScheduledTaskContext,
  PluginSessionRow,
  PluginSessionUiChooseArgs,
  PluginSessionUiChooseRule,
  PluginToolLikeStepEmitter,
  PluginToolLikeStepPayload,
  PluginToolLikeStepState,
  PluginTurnContext,
  PluginTurnHandleResult
} from "./runtime-contract.js";

/** 将插件回合返回值规范为 `PluginTurnHandleResult`（默认 `continue: false`） */
export { toTurnResult } from "./turn-result.js";

/** 构造单条 `PluginSessionRow` 的便捷函数（decorateSessions 等） */
export { toSessionRow } from "./session-row.js";

/** 插件侧调用宿主 MCP 前的权限/声明守卫（失败返回结构化原因，不抛异常） */
export {
  guardInvokeHostMcpTool,
  type GuardInvokeHostMcpToolFail,
  type GuardInvokeHostMcpToolOk,
  type GuardInvokeHostMcpToolResult
} from "./host-mcp-guard.js";

/** 插件侧调用宿主 LLM 前的能力/策略守卫 */
export {
  guardInvokeHostLlm,
  type GuardInvokeHostLlmFail,
  type GuardInvokeHostLlmOk,
  type GuardInvokeHostLlmResult
} from "./host-llm-guard.js";

/**
 * 可选抽象基类：workspace / MCP / LLM / ingest 桥接封装及 emit 工具步骤；
 * 非继承场景请改用 `TurnContextEmitter`。
 */
export {
  BasePluginRuntime,
  PluginBridgeError,
  type BasePluginRuntimeOptions,
  type RuntimeBridgeName
} from "./plugin-runtime-base.js";

/** 包装 `PluginTurnContext`，提供 `emitAssistantDelta` / `emitTool*` 等与基类一致的上报方法，便于组合到其它类 */
export { TurnContextEmitter } from "./turn-context-emitter.js";

/** 清单 `mcp.allowedServers` 中通配与按 serverId 校验 */
export {
  MCP_ALLOWED_SERVERS_WILDCARD,
  mcpAllowedServersAllowsServerId,
  mcpAllowedServersHasWildcard
} from "./mcp-allowed-servers.js";
