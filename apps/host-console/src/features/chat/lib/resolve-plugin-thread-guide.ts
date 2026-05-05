import type { PluginGuide, PluginGuideSuggestion, PluginListItem } from "../../../lib/api/plugins.api";

/** 宿主内置默认（与任一插件 id 无关）。清单未声明 `guide` 或分支缺省时使用。 */
export const PLUGIN_THREAD_GUIDE_PLATFORM_DEFAULTS = {
  welcome: "你好呀!\n今天我能帮您什么忙?",
  suggestions: [
    { prompt: "天气怎么样?\n在旧金山?", text: "天气怎么样?\n在旧金山?" },
    {
      prompt: "解释 React Hooks。\n例如 useState 和 useEffect",
      text: "解释 React Hooks。\n例如 useState 和 useEffect"
    }
  ],
  multiSession: {
    defaultSessionWelcome:
      "欢迎使用多会话运行时插件。\n当前为默认引导会话，请查看插件说明；若插件提供命令，可尝试以 / 开头输入（如 /help）。",
    sessionWelcome:
      "已进入业务会话。\n可直接输入消息或使用插件支持的命令（以 / 开头，具体以插件说明为准）。",
    defaultSessionSuggestions: [{ prompt: "/help", text: "/help" }],
    sessionSuggestions: [{ prompt: "/help", text: "/help" }]
  }
} as const;

type ThreadSuggestion = { prompt: string; text: string };

function normalizeSuggestions(
  rows: PluginGuideSuggestion[] | undefined,
  fallback: readonly ThreadSuggestion[]
): ThreadSuggestion[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return fallback.map((x) => ({ ...x }));
  }
  return rows.map((r) => ({
    prompt: r.prompt,
    text: typeof r.text === "string" && r.text.length > 0 ? r.text : r.prompt
  }));
}

function pickSuggestionChain(
  primary: PluginGuideSuggestion[] | undefined,
  secondary: PluginGuideSuggestion[] | undefined,
  fallback: readonly ThreadSuggestion[]
): ThreadSuggestion[] {
  const a = normalizeSuggestions(primary, []);
  if (a.length > 0) return a;
  const b = normalizeSuggestions(secondary, []);
  if (b.length > 0) return b;
  return normalizeSuggestions(undefined, fallback);
}

/** 解析 Thread 组件用的 `welcome.message` 与 `suggestions`（不写死插件 id）。 */
export function resolvePluginThreadGuide(plugin: PluginListItem, sessionId: string): {
  welcomeMessage: string;
  suggestions: ThreadSuggestion[];
} {
  const manifest = plugin.manifest;
  const guide: PluginGuide | undefined = manifest?.guide;
  const isMultiRuntime =
    manifest?.kind === "runtime_plugin" && manifest?.sessionProvider?.mode === "multi";

  if (isMultiRuntime) {
    const isDefault = sessionId === `${plugin.pluginId}:default`;
    const ms = guide?.multiSession;
    const d = PLUGIN_THREAD_GUIDE_PLATFORM_DEFAULTS.multiSession;
    const welcome = isDefault
      ? ms?.defaultSessionWelcome ?? guide?.welcome ?? d.defaultSessionWelcome
      : ms?.sessionWelcome ?? guide?.welcome ?? d.sessionWelcome;
    const suggestions = isDefault
      ? pickSuggestionChain(ms?.defaultSessionSuggestions, guide?.suggestions, d.defaultSessionSuggestions)
      : pickSuggestionChain(ms?.sessionSuggestions, guide?.suggestions, d.sessionSuggestions);
    return { welcomeMessage: welcome, suggestions };
  }

  const p = PLUGIN_THREAD_GUIDE_PLATFORM_DEFAULTS;
  return {
    welcomeMessage: guide?.welcome ?? p.welcome,
    suggestions: pickSuggestionChain(guide?.suggestions, undefined, p.suggestions)
  };
}
