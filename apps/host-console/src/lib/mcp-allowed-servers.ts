/**
 * 与 `@wclaw/plugin-sdk` 中 `mcp-allowed-servers` 语义一致；控制台单独维护以避免
 * 从 SDK 入口拉入 `plugin-runtime-base`（Node 内置依赖）进入 Vite 浏览器包。
 */
export function mcpAllowedServersAllowsServerId(
  serverId: string,
  allowed: readonly string[] | undefined
): boolean {
  const list = (allowed ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (list.length === 0) return false;
  if (list.includes("*")) return true;
  return list.includes(serverId);
}
