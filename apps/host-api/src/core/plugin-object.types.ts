import type { PluginRuntimeExtension, PluginSessionRow } from "@wclaw/plugin-sdk";

export type PluginManifest = {
  id: string;
  displayName: string;
  kind: "runtime_plugin" | "command_plugin";
  commandMode?: "ephemeral_no_context" | "ephemeral_with_context" | "isolated_chat";
  version: string;
  description: string;
  entry: string;
  /** 插件层 system prompt：用于告知模型该插件职责、可用命令与输出风格。 */
  systemPrompt?: string;
  mcp?: {
    /** 新语义：按 server alias 允许（如 "playwright"） */
    allowedServers?: string[];
    /** 兼容旧字段 */
    allowedTools?: string[];
    deniedTools?: string[];
  };
  sessionProvider?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
};


export type PluginObjectItem = {
  pluginId: string;
  status: "valid" | "invalid";
  manifestPath: string;
  manifest?: PluginManifest;
  object?: PluginRuntimeExtension;
  /** 宿主侧便捷能力：按 sessionId 获取单条会话行。 */
  getSessionRow?: (sessionId: string) => Promise<PluginSessionRow>;
  errors?: string[];
};
