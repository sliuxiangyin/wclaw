import type { PluginRuntimeExtension, PluginSessionRow } from "@wclaw/plugin-sdk";

/** Chat 空线程欢迎语与快捷建议；所有 `kind` 共用同一 JSON 形状，`multiSession` 仅在「多会话 runtime」时读取。 */
export type PluginGuideSuggestion = {
  prompt: string;
  /** 展示用短标签；缺省与 `prompt` 相同 */
  text?: string;
};

export type PluginGuideMultiSession = {
  defaultSessionWelcome?: string;
  sessionWelcome?: string;
  defaultSessionSuggestions?: PluginGuideSuggestion[];
  sessionSuggestions?: PluginGuideSuggestion[];
};

export type PluginGuide = {
  /** 通用：command_plugin / single-session；或多会话但未配置 `multiSession` 某分支时的回退 */
  welcome?: string;
  suggestions?: PluginGuideSuggestion[];
  /** 仅 `runtime_plugin` + `sessionProvider.mode=multi`：`${id}:default` 与其余会话可分开展示 */
  multiSession?: PluginGuideMultiSession;
};

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
  guide?: PluginGuide;
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
