import {
  BasePluginRuntime,
  type ExternalUserTurnInput,
  type ExternalUserTurnResult,
  type PluginClearSessionContext,
  type PluginExecuteCompletedInput,
  type PluginRuntimeExtensionDeps,
  type PluginScheduledTask,
  type PluginScheduledTaskContext,
  type PluginSessionRow,
  type PluginTurnContext,
  type PluginTurnHandleResult
} from "@wclaw/plugin-sdk";
import { clearSession } from "./runtime/clear-session.js";
import { decorateSessions } from "./runtime/decorate-sessions.js";
import { handleChatTurn } from "./runtime/handle-chat.js";
import { reflowChatToChannel } from "./runtime/reflow-chat-to-channel.js";
import { getScheduledTasks, runScheduledTask } from "./runtime/scheduled-tasks.js";

export default class WeixinBridgeRuntime extends BasePluginRuntime {
  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps);
  }

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    console.log("executeTurn", ctx);
    
    return handleChatTurn(this.pluginId, ctx);
  }

  decorateSessions(): Promise<PluginSessionRow[]> {
    return decorateSessions(this.pluginId);
  }

  getScheduledTasks(): PluginScheduledTask[] {
    return getScheduledTasks();
  }

  runScheduledTask(taskId: string, ctx: PluginScheduledTaskContext): Promise<void> | void {
    return runScheduledTask(this.pluginId, taskId, ctx, this.publish.bind(this), {
      ingestExternalUserTurn: this.createOptionalIngestBridge()
    });
  }

  executeCompleted(input: PluginExecuteCompletedInput): Promise<void> {
    return reflowChatToChannel(this.pluginId, input);
  }

  clearSession(ctx: PluginClearSessionContext): Promise<void> | void {
    return clearSession(this.pluginId, ctx);
  }

  private createOptionalIngestBridge(): PluginRuntimeExtensionDeps["ingestExternalUserTurn"] | undefined {
    if (!this.hasBridge("ingest")) return undefined;
    return async (payload: ExternalUserTurnInput): Promise<ExternalUserTurnResult> => {
      try {
        return await this.ingest.call(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, code: "ingest_failed", message };
      }
    };
  }
}
