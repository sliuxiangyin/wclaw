import type { PluginRuntimePort } from "../core/plugin-runtime.port.js";
import { HOST_EVENT_TOPICS } from "../providers/host-event-hub-provider/host-event-hub.topics.js";
import type { HostEventHub } from "../providers/host-event-hub-provider/host-event-hub.js";
import type { PluginRuntimeProvider } from "../providers/plugin-runtime-provider/plugin-runtime.provider.js";
import { createIngestExternalUserTurnForPlugin } from "../services/register-plugin/external-user-turn.service.js";
import { createInvokeHostLlmForPlugin } from "../services/register-plugin/invoke-host-llm.service.js";
import {
  createInvokeHostMcpToolForPlugin,
  createReleaseHostMcpContextForPlugin
} from "../services/register-plugin/invoke-host-mcp.service.js";
import type { McpGatewayService } from "../services/mcp-gateway/mcp-gateway.service.js";

/**
 * 在组合根为各 runtime 插件注入 `ingestExternalUserTurn`、`invokeHostMcpTool`、`invokeHostLlm`（ingest 带会话更新通知；LLM/MCP 为窄能力）。
 */
export function registerPluginIngestAndHostBridge(
  hostEventHub: HostEventHub,
  pluginRuntimeProvider: PluginRuntimeProvider,
  mcpGateway: McpGatewayService
): void {
  const notifyChatSessionUpdated = (p: {
    pluginId: string;
    sessionId: string;
    source?: { kind: string; ref?: string };
    metadata?: Record<string, unknown>;
  }) => {
    try {
      hostEventHub.publish({
        topics: [HOST_EVENT_TOPICS.Chat],
        notification: {
          type: "chat.session.updated",
          level: "info",
          scope: { pluginId: p.pluginId, sessionId: p.sessionId },
          payload: {
            reason: "external.ingest.completed",
            source: p.source ?? null,
            metadata: p.metadata ?? null
          }
        }
      });
    } catch {
      // Hub 单 Sink 失败忽略
    }
  };

  const ingestArgs = ({ pluginId, getPluginRuntime }: { pluginId: string; getPluginRuntime: () => PluginRuntimePort }) => ({
    pluginId,
    getPluginRuntime,
    notifyChatSessionUpdated
  });

  const mcpArgs = ({ pluginId, getPluginRuntime }: { pluginId: string; getPluginRuntime: () => PluginRuntimePort }) => ({
    pluginId,
    getPluginRuntime,
    mcpGateway
  });

  pluginRuntimeProvider.setIngestExternalUserTurn((input) =>
    createIngestExternalUserTurnForPlugin(ingestArgs(input))
  );
  pluginRuntimeProvider.setInvokeHostMcpTool((input) => createInvokeHostMcpToolForPlugin(mcpArgs(input)));
  pluginRuntimeProvider.setReleaseHostMcpContext((input) => createReleaseHostMcpContextForPlugin(mcpArgs(input)));

  pluginRuntimeProvider.setInvokeHostLlm((input) => createInvokeHostLlmForPlugin(input));
}
