import type { PluginRuntimeExtensionDeps } from "@wclaw/plugin-sdk";
import type { PluginObjectItem } from "./plugin-object.types.js";

/** 组合根注入：按 `pluginId` 构造 `ingestExternalUserTurn`（实现来自 `services/ai-chat`）。 */
export type IngestExternalUserTurnFactoryInput = {
  pluginId: string;
  getPluginRuntime: () => PluginRuntimePort;
};

export type CreateIngestExternalUserTurnFactory = (
  input: IngestExternalUserTurnFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["ingestExternalUserTurn"]>;

export type CreateInvokeHostMcpToolFactory = (
  input: IngestExternalUserTurnFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["invokeHostMcpTool"]>;

export type CreateReleaseHostMcpContextFactory = (
  input: IngestExternalUserTurnFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["releaseHostMcpContext"]>;

export type CreateInvokeHostLlmFactory = (
  input: IngestExternalUserTurnFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["invokeHostLlm"]>;

/**
 * 插件运行时 + 目录（由 `PluginRuntimeProvider` 实现）。
 * `services` 仅通过 **函数参数** 接收本类型，禁止在 service 内值导入 `providers` 实现。
 * `ingestExternalUserTurn` / `invokeHostMcpTool` / `releaseHostMcpContext` / `invokeHostLlm`
 * 由组合根在 `PluginRuntimeProvider` 工厂中注入。
 */
export type PluginRuntimePort = {
  /** 单条目录项；运行时实例见返回值的 `object`。 */
  plugin(pluginId: string): Promise<PluginObjectItem | null>;
  listPlugins(): Promise<{ items: PluginObjectItem[] }>;
};
