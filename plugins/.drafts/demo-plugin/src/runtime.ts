import type { PluginRuntimeExtensionDeps, PluginTurnContext, PluginTurnHandleResult } from "@wclaw/plugin-sdk";
import { BasePluginRuntime, toTurnResult } from "@wclaw/plugin-sdk";

export default class DemoPluginRuntime extends BasePluginRuntime {
  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps, { requiredBridges: [] });
  }

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    const msg = String(ctx.message ?? "").trim();
    if (!msg) {
      return toTurnResult("[" + this.pluginId + "] 草稿占位：请发送一条消息开始。");
    }
    return toTurnResult("[" + this.pluginId + "] 草稿占位（可自行改 src/runtime.ts）：\n\n" + msg.slice(0, 4000));
  }
}
