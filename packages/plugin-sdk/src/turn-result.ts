import type { PluginChatPersistRow, PluginTurnHandleResult } from "./runtime-contract.js";

type BuildTurnResultOptions = {
  continue?: boolean;
  persist?: PluginChatPersistRow[];
};

/**
 * 统一构造 executeTurn 返回对象。
 * 约定默认值：continue=false、persist=[]。
 */
export function toTurnResult(text: unknown, options: BuildTurnResultOptions = {}): PluginTurnHandleResult {
  return {
    text: typeof text === "string" ? text : String(text ?? ""),
    continue: options.continue ?? false,
    persist: Array.isArray(options.persist) ? options.persist : []
  };
}
