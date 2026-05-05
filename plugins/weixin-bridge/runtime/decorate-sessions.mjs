import { listAccounts } from "../bridge-adapter.mjs";
import { toSessionRow } from "@wclaw/plugin-sdk";

/**
 * 会话列表唯一来源：
 * - 默认会话
 * - listAccounts() 返回的账号会话
 */
export async function decorateSessions(pluginId) {
  const defaultSessionId = `${pluginId}:default`;
  const accountPrefix = `${pluginId}:account-`;

  const merged = new Map();
  merged.set(
    defaultSessionId,
    toSessionRow({
      sessionId: defaultSessionId,
      persistence: "ephemeral",
      forceExecuteTurn: true
    })
  );

  let accounts = [];
  try {
    accounts = await listAccounts();
  } catch {
    accounts = [];
  }
  for (const acc of accounts) {
    const accountId = String(acc.accountId);
    const sid = `${accountPrefix}${accountId}`;
    merged.set(
      sid,
      toSessionRow({
        sessionId: sid,
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
  const ordered = [...def, ...rest];
 
  return ordered.map((s) => {
    if (s.sessionId.startsWith(accountPrefix)) {
      const accountId = s.sessionId.slice(accountPrefix.length);
      return { ...s, title: `微信账号 ${accountId}` };
    }
    if (s.sessionId === defaultSessionId) {
      return { ...s, title: "默认会话" };
    }
    return { ...s, title: s.title ?? s.sessionId };
  });
}
