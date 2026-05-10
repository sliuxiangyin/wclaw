/**
 * `plugin.json` → `mcp.allowedServers` 中的通配项：表示允许当前宿主 MCP 网关
 * catalog 中出现的全部 serverId（仍受会话级禁用等策略约束）。
 */
export const MCP_ALLOWED_SERVERS_WILDCARD = "*";

function normalizeAllowedServers(allowed: readonly string[] | undefined): string[] {
  if (!allowed?.length) return [];
  return allowed.map((x) => String(x).trim()).filter(Boolean);
}

export function mcpAllowedServersHasWildcard(allowed: readonly string[] | undefined): boolean {
  return normalizeAllowedServers(allowed).includes(MCP_ALLOWED_SERVERS_WILDCARD);
}

export function mcpAllowedServersAllowsServerId(
  serverId: string,
  allowed: readonly string[] | undefined
): boolean {
  const list = normalizeAllowedServers(allowed);
  if (list.length === 0) return false;
  if (list.includes(MCP_ALLOWED_SERVERS_WILDCARD)) return true;
  return list.includes(serverId);
}
