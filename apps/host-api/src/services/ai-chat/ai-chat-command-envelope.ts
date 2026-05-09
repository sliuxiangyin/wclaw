/**
 * 宿主级命令信封 `/command <pluginId> [args]`（与插件内 `/login` 等斜杠命令区分）
 */

import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import type { PluginObjectItem } from "../plugin-catalog/plugin-catalog.service.js";
import { resolveCommandPluginMode } from "./ai-chat-command-plugin.js";
import { parseMcpExplicitCommand, type ParsedMcpExplicitCommand } from "./ai-chat-mcp-explicit-command.js";

export type HostCommandRoute = {
  targetPluginId: string;
  commandText: string;
};

export type CommandMessageParseTestCase = {
  input: string;
  hostPluginId: string;
  expected: HostCommandRoute | null;
};

export type CommandMessageParseTestResult = {
  input: string;
  hostPluginId: string;
  expected: HostCommandRoute | null;
  actual: HostCommandRoute | null;
  passed: boolean;
};

/**
 * 不参与 IO：仅用「会话态 + 用户末条文案」决定要走的编排分支，
 * 供 `dispatchAiOrchestration` 使用 `switch` 分发。
 */
export type AiOrchestrationPath =
  | { kind: "isolated_close" }
  /** 隔离内、无显式斜杠命令：仅宿主 LLM，使用隔离目标插件的 manifest（systemPrompt / MCP 声明） */
  | { kind: "isolated_plain_llm"; isolatedPluginId: string }
  | { kind: "command_plugin_usage_hint" }
  | { kind: "host_bad_format" }
  | { kind: "host_mcp_cross_plugin_forbidden" }
  | { kind: "runtime_default" }
  | { kind: "host_command"; targetPluginId: string; commandText: string }
  | {
      kind: "host_mcp_command";
      targetPluginId: string;
      commandText: string;
      parsedMcp: ParsedMcpExplicitCommand;
    };

/**
 * 路由判别（与 `resolveCommandPluginMode` 对齐）：
 *
 * 1. 隔离模式：以 **隔离目标插件 id** 参与短命令解析；`/close` 退出；有斜杠命中则 `host_command`；否则 `isolated_plain_llm`。
 * 2. `ephemeral_no_context`：无斜杠命中 → `command_plugin_usage_hint`；有斜杠 → `host_command`。
 * 3. `ephemeral_with_context` / `isolated_chat`：无斜杠 → `runtime_default`（宿主 LLM + 插件 systemPrompt/MCP）；有斜杠 → `host_command`。
 * 4. `runtime_plugin` 且 `sessionRow.forceExecuteTurn === true`：无斜杠仍将全文当命令 **host_command**；有斜杠按解析走。
 * 5. 其余：有斜杠 → `host_command`，无斜杠 → `runtime_default`。
 * 6. 命令解析：先长命令 `/command <pluginId> [args]`，再短命令 `/xxx`（“虚拟 host”为当前会话 host 插件 id；隔离内为隔离目标 id）。
 */
export class AiChatCommandEnvelope {
  static async handler(
    state: ChatSessionState,
    userMessage: string,
    plugin: PluginObjectItem
  ): Promise<AiOrchestrationPath> {
    if (state.mode === "isolated" && state.isolatedPluginId) {
      if (userMessage.trim() === "/close") return { kind: "isolated_close" };
      const iso = state.isolatedPluginId;
      const routedIso = this.parseHostCommandRoute(iso, userMessage);
      if (routedIso) {
        return this.resolveHostCommandOrMcpPath(
          plugin.pluginId,
          routedIso.targetPluginId,
          routedIso.commandText
        );
      }
      return { kind: "isolated_plain_llm", isolatedPluginId: iso };
    }

    const manifest = plugin.manifest;
    if (!manifest) return { kind: "runtime_default" };

    const cmdMode = resolveCommandPluginMode(manifest);
    const sessionRow = plugin.getSessionRow
      ? await plugin.getSessionRow(state.sessionId)
      : undefined;

    const routed = this.parseHostCommandRoute(plugin.pluginId, userMessage);

    const forceCommandEveryMessage =
      cmdMode === "runtime_plugin" && sessionRow?.forceExecuteTurn === true;

    if (forceCommandEveryMessage) {
      const targetPluginId = routed?.targetPluginId ?? plugin.pluginId;
      const commandText = routed?.commandText ?? (userMessage.trim() || "default");
      return this.resolveHostCommandOrMcpPath(plugin.pluginId, targetPluginId, commandText);
    }

    if (cmdMode === "ephemeral_no_context") {
      if (routed) {
        return this.resolveHostCommandOrMcpPath(
          plugin.pluginId,
          routed.targetPluginId,
          routed.commandText
        );
      }
      return { kind: "command_plugin_usage_hint" };
    }

    if (cmdMode === "ephemeral_with_context" || cmdMode === "isolated_chat") {
      if (routed) {
        return this.resolveHostCommandOrMcpPath(
          plugin.pluginId,
          routed.targetPluginId,
          routed.commandText
        );
      }
      return { kind: "runtime_default" };
    }

    if (routed) {
      return this.resolveHostCommandOrMcpPath(plugin.pluginId, routed.targetPluginId, routed.commandText);
    }

    return { kind: "runtime_default" };
  }

  private static resolveHostCommandOrMcpPath(
    hostPluginId: string,
    targetPluginId: string,
    commandText: string
  ): AiOrchestrationPath {
    const parsedMcp = parseMcpExplicitCommand(commandText);
    if (parsedMcp) {
      if (targetPluginId !== hostPluginId) {
        return { kind: "host_mcp_cross_plugin_forbidden" };
      }
      return {
        kind: "host_mcp_command",
        targetPluginId,
        commandText,
        parsedMcp
      };
    }
    return {
      kind: "host_command",
      targetPluginId,
      commandText
    };
  }

  /**
   * 长命令 `/command <pluginId> [args]` 优先；
   * 否则短命令 `/xxx`：
   * - 若首 token 形如插件 id 且包含 `-`（如 `/linux-do-fetch`），按「直达目标插件」解析；
   * - 其它情况仍按当前 host 插件命令解析（兼容 `/help` 等）。
   */
  static parseHostCommandRoute(hostPluginId: string, message: string): HostCommandRoute | null {
    const trimmed = message.trim();
    if (/^\/command(?:\s|$)/i.test(trimmed)) {
      const m = /^\/command(?:\s+([a-z0-9-]+))?(?:\s+([\s\S]+))?$/i.exec(trimmed);
      const targetPluginId = m?.[1]?.trim();
      if (!targetPluginId) return null;
      return {
        targetPluginId,
        commandText: (m?.[2] ?? "").trim()
      };
    }
    if (trimmed.startsWith("/") && trimmed !== "/") {
      const body = trimmed.slice(1).trim();
      if (!body) return null;
      const m = /^([a-z0-9-]+)(?:\s+([\s\S]+))?$/i.exec(body);
      const maybePluginId = m?.[1]?.trim().toLowerCase() ?? "";
      const rest = (m?.[2] ?? "").trim();
      if (maybePluginId.includes("-")) {
        return {
          targetPluginId: maybePluginId,
          commandText: rest
        };
      }
      return { targetPluginId: hostPluginId, commandText: body };
    }
    return null;
  }

  /**
   * 轻量自测：校验 `parseHostCommandRoute` 对长/短命令的解析。
   */
  static testParseHostCommandRoute(
    cases: CommandMessageParseTestCase[] = [
      {
        input: "/command command-smoke ping",
        hostPluginId: "weixin-bridge",
        expected: { targetPluginId: "command-smoke", commandText: "ping" }
      },
      {
        input: "/help",
        hostPluginId: "weixin-bridge",
        expected: { targetPluginId: "weixin-bridge", commandText: "help" }
      },
      {
        input: "/linux-do-fetch",
        hostPluginId: "weixin-bridge",
        expected: { targetPluginId: "linux-do-fetch", commandText: "" }
      },
      {
        input: "/linux-do-fetch run",
        hostPluginId: "weixin-bridge",
        expected: { targetPluginId: "linux-do-fetch", commandText: "run" }
      },
      {
        input: "hello",
        hostPluginId: "weixin-bridge",
        expected: null
      },
      {
        input: "/",
        hostPluginId: "weixin-bridge",
        expected: null
      }
    ]
  ): CommandMessageParseTestResult[] {
    return cases.map((c) => {
      const actual = this.parseHostCommandRoute(c.hostPluginId, c.input);
      const passed = JSON.stringify(actual) === JSON.stringify(c.expected);
      return {
        input: c.input,
        hostPluginId: c.hostPluginId,
        expected: c.expected,
        actual,
        passed
      };
    });
  }
}
