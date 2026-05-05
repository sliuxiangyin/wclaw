/**
 * 宿主级命令信封 `/command <pluginId> [args]`（与插件内 `/login` 等斜杠命令区分）
 */

import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import type { PluginObjectItem } from "../plugin-catalog/plugin-catalog.service.js";
import { resolveCommandPluginMode } from "./ai-chat-command-plugin.js";

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
  | { kind: "isolated_delegate" }
  | { kind: "host_bad_format" }
  | { kind: "runtime_default" }
  | { kind: "host_command"; targetPluginId: string; commandText: string };

/**
 * 路由判别（与 `resolveCommandPluginMode` 对齐）：
 *
 * 1. `ephemeral_no_context`：无论是否有显式命令，一律 `host_command`（无解析命中时用当前插件 + 全文）。
 * 2. `ephemeral_with_context`：同上。
 * 3. 其它（如 `runtime_plugin` 未 force、`isolated_chat` 等）：仅当解析到命令时 `host_command`，否则 `runtime_default`。
 * 4. 命令解析：先长命令 `/command <pluginId> [args]`，再短命令 `/xxx`（目标为当前 host 插件）。
 * 5. `runtime_plugin` 且 `sessionRow.forceExecuteTurn === true`：一律 `host_command`（规则同 1/2）。
 */
export class AiChatCommandEnvelope {
  static async handler(
    state: ChatSessionState,
    userMessage: string,
    plugin: PluginObjectItem
  ): Promise<AiOrchestrationPath> {
    if (state.mode === "isolated" && state.isolatedPluginId) {
      if (userMessage.trim() === "/close") return { kind: "isolated_close" };
      return { kind: "isolated_delegate" };
    }

    const manifest = plugin.manifest;
    if (!manifest) return { kind: "runtime_default" };

    const cmdMode = resolveCommandPluginMode(manifest);
    const sessionRow = plugin.getSessionRow
      ? await plugin.getSessionRow(state.sessionId)
      : undefined;

    const routed = this.parseHostCommandRoute(plugin.pluginId, userMessage);

    const alwaysHostCommand =
      cmdMode === "ephemeral_no_context" ||
      cmdMode === "ephemeral_with_context" ||
      (cmdMode === "runtime_plugin" && sessionRow?.forceExecuteTurn === true);

    if (alwaysHostCommand) {
      if (routed) {
        return {
          kind: "host_command",
          targetPluginId: routed.targetPluginId,
          commandText: routed.commandText
        };
      }
      return {
        kind: "host_command",
        targetPluginId: plugin.pluginId,
        commandText: userMessage.trim() || "default"
      };
    }

    if (routed) {
      return {
        kind: "host_command",
        targetPluginId: routed.targetPluginId,
        commandText: routed.commandText
      };
    }

    return { kind: "runtime_default" };
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
