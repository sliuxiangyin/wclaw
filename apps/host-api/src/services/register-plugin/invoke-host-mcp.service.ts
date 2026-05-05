import type {
  HostMcpInvokeInput,
  HostMcpInvokeResult,
  HostMcpReleaseContextInput,
  HostMcpReleaseContextResult
} from "@wclaw/plugin-sdk";
import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import type { McpGatewayService } from "../mcp-gateway/mcp-gateway.service.js";

export type CreateInvokeHostMcpToolForPluginOptions = {
  pluginId: string;
  getPluginRuntime: () => PluginRuntimePort;
  mcpGateway: McpGatewayService;
};

/**
 * 宿主 MCP 网关窄接口：`invokeHostMcpTool({ toolId, arguments })`，`pluginId` 由工厂闭包绑定；
 * 权限与 `plugin.json` 的 `mcp.allowedServers` 一致。
 */
export function createInvokeHostMcpToolForPlugin(
  options: CreateInvokeHostMcpToolForPluginOptions
): (input: HostMcpInvokeInput) => Promise<HostMcpInvokeResult> {
  return async (input: HostMcpInvokeInput): Promise<HostMcpInvokeResult> => {
    const row = await options.getPluginRuntime().plugin(options.pluginId);
    const manifest = row?.manifest;
    if (!manifest) {
      return {
        ok: false,
        code: ERROR_CODES.PLUGIN_NOT_FOUND,
        message: `plugin not found: ${options.pluginId}`
      };
    }
    const allowedServers = manifest.mcp?.allowedServers ?? [];
    if (allowedServers.length === 0) {
      return {
        ok: false,
        code: ERROR_CODES.INVALID_REQUEST,
        message: "[mcp] 当前插件未配置 mcp.allowedServers，拒绝执行。"
      };
    }
    try {
      const { serverId } = options.mcpGateway.splitQualifiedToolId(input.toolId);
      if (!allowedServers.includes(serverId)) {
        return {
          ok: false,
          code: ERROR_CODES.INVALID_REQUEST,
          message: `[mcp] server '${serverId}' 不在 allowedServers 白名单中。`
        };
      }
      const args = options.mcpGateway.validateToolArguments(input.toolId, input.arguments ?? {});
      const result = await options.mcpGateway.invokeTool({
        toolId: input.toolId,
        arguments: args,
        traceId: input.traceId ?? null,
        contextKey: input.contextKey ?? `${options.pluginId}:default`
      });
      return { ok: true, toolId: input.toolId, result };
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, code: ERROR_CODES.MCP_INVOKE_FAILED, message };
    }
  };
}

export function createReleaseHostMcpContextForPlugin(
  options: CreateInvokeHostMcpToolForPluginOptions
): (input: HostMcpReleaseContextInput) => Promise<HostMcpReleaseContextResult> {
  return async (input: HostMcpReleaseContextInput): Promise<HostMcpReleaseContextResult> => {
    const row = await options.getPluginRuntime().plugin(options.pluginId);
    const manifest = row?.manifest;
    if (!manifest) {
      return {
        ok: false,
        code: ERROR_CODES.PLUGIN_NOT_FOUND,
        message: `plugin not found: ${options.pluginId}`
      };
    }
    const allowedServers = manifest.mcp?.allowedServers ?? [];
    if (!allowedServers.includes(input.serverId)) {
      return {
        ok: false,
        code: ERROR_CODES.INVALID_REQUEST,
        message: `[mcp] server '${input.serverId}' 不在 allowedServers 白名单中。`
      };
    }
    try {
      const contextKey = input.contextKey ?? `${options.pluginId}:default`;
      const released = await options.mcpGateway.releaseContext({
        serverId: input.serverId,
        contextKey
      });
      return {
        ok: true,
        serverId: input.serverId,
        contextKey,
        released
      };
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, code: ERROR_CODES.MCP_INVOKE_FAILED, message };
    }
  };
}
