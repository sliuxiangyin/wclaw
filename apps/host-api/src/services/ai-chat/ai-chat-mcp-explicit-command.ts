import { createMcpGatewayService } from "../mcp-gateway/mcp-gateway.service.js";
import type { PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";

export type ParsedMcpExplicitCommand = {
  serverAlias: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type McpCommandResult = {
  pluginId: string;
  command: string;
  output: string;
};

export function parseMcpExplicitCommand(commandText: string): ParsedMcpExplicitCommand | null {
  const raw = String(commandText || "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("/") ? raw.slice(1).trim() : raw;
  const firstSplit = normalized.split(/\s+/, 2);
  if (firstSplit[0] !== "mcp") return null;

  const afterPrefix = normalized.slice(3).trim();
  if (!afterPrefix) {
    return { serverAlias: "", toolName: "", args: {} };
  }
  const secondSplit = afterPrefix.split(/\s+/, 2);
  const serverAlias = secondSplit[0] ?? "";
  const restAfterServer = afterPrefix.slice(serverAlias.length).trim();
  const thirdSplit = restAfterServer.split(/\s+/, 2);
  const toolName = thirdSplit[0] ?? "";
  const argsText = restAfterServer.slice(toolName.length).trim();

  let args: Record<string, unknown> = {};
  if (argsText) {
    try {
      const parsed = JSON.parse(argsText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = {};
    }
  }
  return { serverAlias, toolName, args };
}

export async function executeMcpExplicitCommand(
  commandText: string,
  manifest: PluginManifest
): Promise<McpCommandResult | null> {
  const parsed = parseMcpExplicitCommand(commandText);
  if (!parsed) {
    return null;
  }
  const allowedServers = manifest.mcp?.allowedServers ?? [];
  if (allowedServers.length === 0) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: "[mcp] 当前插件未配置 mcp.allowedServers，拒绝执行。"
    };
  }
  if (!allowedServers.includes(parsed.serverAlias)) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp] server '${parsed.serverAlias}' 不在 allowedServers 白名单中。`
    };
  }

  const gateway = createMcpGatewayService();
  const catalog = gateway.buildCatalog();
  if (parsed.toolName === "__list__") {
    const server = catalog.servers.find((s) => s.id === parsed.serverAlias);
    const tools = catalog.tools.filter((t) => t.serverId === parsed.serverAlias).map((t) => t.name);
    if (!server) {
      return {
        pluginId: manifest.id,
        command: commandText,
        output: `[mcp] server '${parsed.serverAlias}' 不存在于 catalog。`
      };
    }
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp:${parsed.serverAlias}] tools(${tools.length}): ${tools.join(", ")}`
    };
  }
  const matched = catalog.tools.filter((t) => t.serverId === parsed.serverAlias && t.name === parsed.toolName);
  if (matched.length === 0) {
    return {
      pluginId: manifest.id,
      command: commandText,
      output: `[mcp] 未找到工具：${parsed.serverAlias}/${parsed.toolName}（请确认 server 在线且已探测 tools）。`
    };
  }

  const result = await gateway.invokeTool({
    toolId: `${parsed.serverAlias}/${parsed.toolName}`,
    arguments: parsed.args
  });
  return {
    pluginId: manifest.id,
    command: commandText,
    output: `[mcp:${parsed.serverAlias}/${parsed.toolName}] ${safeStringify(result)}`
  };
}

function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}...(truncated)` : text;
  } catch {
    return String(value);
  }
}
