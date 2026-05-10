import { mcpAllowedServersHasWildcard } from "@wclaw/plugin-sdk";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import type { PluginManifest } from "../core/plugin-object.types.js";
import type { McpToolForbidden } from "../repositories/chat-session.repository.js";
import type { McpGatewayService } from "../services/mcp-gateway/mcp-gateway.service.js";

export type PluginMcpAllowedCatalog = {
  servers: Array<{ id: string; displayName?: string }>;
  tools: Array<{ serverId: string; name: string; description?: string }>;
};

export function parseMcpToolForbiddenBody(input: unknown): McpToolForbidden {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "body must be an object", 400);
  }
  const raw = input as { servers?: unknown; tools?: unknown };
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const serverList = servers.map((item) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "servers must be string[]", 400);
    }
    return item.trim();
  });
  const toolsRaw = raw.tools;
  if (toolsRaw !== undefined && (!toolsRaw || typeof toolsRaw !== "object" || Array.isArray(toolsRaw))) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "tools must be Record<string, string[]>", 400);
  }
  const tools: Record<string, string[]> = {};
  for (const [serverId, value] of Object.entries((toolsRaw ?? {}) as Record<string, unknown>)) {
    if (typeof serverId !== "string" || serverId.trim() === "") {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "tools key must be non-empty serverId", 400);
    }
    if (!Array.isArray(value)) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, `tools.${serverId} must be string[]`, 400);
    }
    tools[serverId.trim()] = value.map((item) => {
      if (typeof item !== "string" || item.trim() === "") {
        throw new AppError(ERROR_CODES.INVALID_REQUEST, `tools.${serverId} must be string[]`, 400);
      }
      return item.trim();
    });
  }
  return {
    servers: [...new Set(serverList)],
    tools
  };
}

export function buildPluginMcpAllowedCatalog(
  manifest: PluginManifest,
  mcpGateway: McpGatewayService
): PluginMcpAllowedCatalog {
  const allowedServers = new Set((manifest.mcp?.allowedServers ?? []).map((x) => String(x).trim()).filter(Boolean));
  if (allowedServers.size === 0) return { servers: [], tools: [] };
  const catalog = mcpGateway.buildCatalog();
  const runningServers = catalog.servers.filter((s) => s.enabled);
  const wildcard = mcpAllowedServersHasWildcard(manifest.mcp?.allowedServers);
  const servers = runningServers
    .filter((s) => wildcard || allowedServers.has(s.id))
    .map((s) => ({ id: s.id, displayName: s.displayName }));
  const runningServerIds = new Set(servers.map((s) => s.id));
  const tools = catalog.tools
    .filter((t) => runningServerIds.has(t.serverId))
    .map((t) => ({ serverId: t.serverId, name: t.name, description: t.description }));
  return { servers, tools };
}

export function sanitizeForbiddenByAllowedCatalog(
  raw: McpToolForbidden,
  catalog: PluginMcpAllowedCatalog
): McpToolForbidden {
  const allowedServerIds = new Set(catalog.servers.map((s) => s.id));
  const allowedToolsByServer = new Map<string, Set<string>>();
  for (const tool of catalog.tools) {
    const set = allowedToolsByServer.get(tool.serverId) ?? new Set<string>();
    set.add(tool.name);
    allowedToolsByServer.set(tool.serverId, set);
  }
  const servers = (raw.servers ?? []).filter((serverId) => allowedServerIds.has(serverId));
  const tools: Record<string, string[]> = {};
  for (const [serverId, names] of Object.entries(raw.tools ?? {})) {
    if (!allowedServerIds.has(serverId)) continue;
    const allowedNames = allowedToolsByServer.get(serverId) ?? new Set<string>();
    const filtered = names.filter((name) => allowedNames.has(name));
    if (filtered.length > 0) tools[serverId] = filtered;
  }
  return { servers: [...new Set(servers)], tools };
}

export function assertForbiddenInsideAllowedCatalog(raw: McpToolForbidden, catalog: PluginMcpAllowedCatalog): void {
  const normalized = sanitizeForbiddenByAllowedCatalog(raw, catalog);
  const rawServers = [...new Set(raw.servers ?? [])].sort();
  const normalizedServers = [...new Set(normalized.servers ?? [])].sort();
  if (JSON.stringify(rawServers) !== JSON.stringify(normalizedServers)) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "forbidden servers 超出插件可用 MCP Server 范围", 400);
  }
  const rawToolsEntries = Object.entries(raw.tools ?? {})
    .map(([k, v]) => [k, [...new Set(v)].sort()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const normalizedToolsEntries = Object.entries(normalized.tools ?? {})
    .map(([k, v]) => [k, [...new Set(v)].sort()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (JSON.stringify(rawToolsEntries) !== JSON.stringify(normalizedToolsEntries)) {
    throw new AppError(ERROR_CODES.INVALID_REQUEST, "forbidden tools 超出插件可用 MCP 工具范围", 400);
  }
}
