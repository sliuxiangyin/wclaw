import { clearSession } from "./runtime/clear-session.mjs";
import { decorateSessions } from "./runtime/decorate-sessions.mjs";
import { handleChatTurn } from "./runtime/handle-chat.mjs";
import { reflowChatToChannel as reflowChatToChannelImpl } from "./runtime/reflow-chat-to-channel.mjs";
import { getScheduledTasks, runScheduledTask } from "./runtime/scheduled-tasks.mjs";
import { BasePluginRuntime } from "@wclaw/plugin-sdk";

/**
 * @typedef {import("@wclaw/plugin-sdk").PluginRuntimeExtensionDeps} WeixinBridgeRuntimeDeps
 * @typedef {import("@wclaw/plugin-sdk").PluginTurnContext} PluginTurnContext
 * @typedef {import("@wclaw/plugin-sdk").PluginScheduledTaskContext} PluginScheduledTaskContext
 * @typedef {import("@wclaw/plugin-sdk").PluginClearSessionContext} PluginClearSessionContext
 * @typedef {import("@wclaw/plugin-sdk").PluginExecuteCompletedInput} PluginExecuteCompletedInput
 */

/**
 * 微信桥 runtime_plugin：宿主 `new WeixinBridgeRuntime(deps)` 后调实例方法。
 * 逻辑仍拆分在 `./runtime/*.mjs`；**不**修改 `openclaw-weixin/` 子项目。
 */
export default class WeixinBridgeRuntime extends BasePluginRuntime {
  /**
   * @param {WeixinBridgeRuntimeDeps} deps
   */
  constructor(deps) {
    super(deps);
  }

  /**
   * 单轮输入入口（与 `docs/插件/插件实例与编排.md` 一致）；实现位于 `./runtime/handle-chat.mjs`。
   * 使用 `async`：`handleChatTurn` 内含扫码等待等耗时步骤，宿主侧 `Promise.resolve` 可统一接 Promise 或值。
   * @param {PluginTurnContext} ctx
   * @returns {Promise<import("@wclaw/plugin-sdk").PluginTurnHandleResult>}
   */
  async executeTurn(ctx) {
    return await handleChatTurn(this.pluginId, ctx);
  }

  /**
   * @returns {import("@wclaw/plugin-sdk").PluginSessionRow[] | Promise<import("@wclaw/plugin-sdk").PluginSessionRow[]>}
   */
  decorateSessions() {
    return decorateSessions(this.pluginId);
  }

  /** @returns {import("@wclaw/plugin-sdk").PluginScheduledTask[]} */
  getScheduledTasks() {
    return getScheduledTasks();
  }

  /**
   * @param {string} taskId
   * @param {PluginScheduledTaskContext} ctx
   * @returns {void | Promise<void>}
   */
  runScheduledTask(taskId, ctx) {
    return runScheduledTask(this.pluginId, taskId, ctx, this.publish.bind(this), {
      ingestExternalUserTurn: this.createOptionalIngestBridge()
    });
  }

  /**
   * 编排落库成功后回流外部渠道。
   * @param {PluginExecuteCompletedInput} input
   * @returns {Promise<void>}
   */
  executeCompleted(input) {
    return reflowChatToChannelImpl(this.pluginId, input);
  }

  /**
   * @param {PluginClearSessionContext} ctx
   * @returns {void | Promise<void>}
   */
  clearSession(ctx) {
    return clearSession(this.pluginId, ctx);
  }

  createOptionalIngestBridge() {
    if (!this.hasBridge("ingest")) return undefined;
    return async (payload) => {
      try {
        return await this.ingestExternalUserTurn(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, code: "ingest_failed", message };
      }
    };
  }
}
