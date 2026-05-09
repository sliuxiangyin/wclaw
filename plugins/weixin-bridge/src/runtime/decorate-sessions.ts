import { toSessionRow, type PluginSessionRow } from "@wclaw/plugin-sdk";
import { listAccounts } from "../adapters/openclaw-runtime.js";

/**
 * 会话列表唯一来源：
 * - 默认会话
 * - listAccounts() 返回的账号会话
 */
export async function decorateSessions(pluginId: string): Promise<PluginSessionRow[]> {
  const defaultSessionId = `${pluginId}:default`;
  const accountPrefix = `${pluginId}:account-`;

  const merged = new Map<string, PluginSessionRow>();
  merged.set(
    defaultSessionId,
    toSessionRow({
      sessionId: defaultSessionId,
      title: "默认会话",
      ui: {
        subtitle: "登录与引导",
        badges: ["wechat", "onboarding"],
        welcome: "Hello there!\nHow can I help you today?",
        suggestions: [
          { prompt: "/login", text: "开始扫码登录" },
          { prompt: "/help", text: "查看命令帮助" }
        ]
      },
      persistence: "ephemeral",
      forceExecuteTurn: true
    })
  );

  let accounts = await listAccounts().catch(() => []);
  for (const acc of accounts) {
    const accountId = String(acc.accountId);
    const sid = `${accountPrefix}${accountId}`;
    merged.set(
      sid,
      toSessionRow({
        sessionId: sid,
        title: `微信账号 ${accountId}`,
        ui: {
          subtitle: `账号会话 ${accountId}`,
          badges: ["wechat", "account"],
          welcome: `已进入账号会话：${accountId}\n可以直接发送消息，或使用 /help 查看命令。`,
          suggestions: [
            { prompt: "/help", text: "查看命令帮助" },
            { prompt: "帮我查看最近会话摘要", text: "最近会话摘要" }
          ]
        },
        persistence: "persist"
      })
    );
  }

  const all = [...merged.values()];
  const def = all.filter((r) => r.sessionId === defaultSessionId);
  const rest = all.filter((r) => r.sessionId !== defaultSessionId);
  rest.sort((a, b) => {
    if (a.updatedAt < b.updatedAt) return 1;
    if (a.updatedAt > b.updatedAt) return -1;
    return 0;
  });
  return [...def, ...rest];
}
