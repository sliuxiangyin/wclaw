import type { PluginChatPersistRow, PluginTurnHandleResult } from "./runtime-contract.js";

type BuildTurnResultOptions = {
  /**
   * `true`：需由宿主再接 LLM 等后续编排（`ephemeral_with_context` 下 `text` 会作为发给 LLM 的 user 内容，不单独作为最终助手气泡）。
   * `false` 或未传：与本函数默认一致，本轮 `text` 即对用户的最终输出。
   */
  continue?: boolean;
  /**
   * 在宿主落库时**额外追加**的消息行（`user` / `assistant`），可指向本会话或其它同属该插件的 `sessionId`；
   * 宿主会校验 `sessionId` 归属后再写入。
   */
  persist?: PluginChatPersistRow[];
};

/**
 * 统一构造 executeTurn 返回对象。
 * 约定：`persist` 默认为 `[]`；`continue` 未传入时默认为 **`false`**（本轮 `text` 即最终对用户回复；需接宿主 LLM 时请显式传 `continue: true`）。
 */
export function toTurnResult(text: unknown, options: BuildTurnResultOptions = {}): PluginTurnHandleResult {
  return {
    text: typeof text === "string" ? text : String(text ?? ""),
    continue: options.continue ?? false,
    persist: Array.isArray(options.persist) ? options.persist : []
  };
}
