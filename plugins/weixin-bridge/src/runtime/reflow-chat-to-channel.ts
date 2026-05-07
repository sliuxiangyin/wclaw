import type { PluginExecuteCompletedInput } from "@wclaw/plugin-sdk";
import { sendMessage } from "../adapters/openclaw-runtime.js";
import { accountIdFromSession } from "./session-state.js";

/**
 * 将宿主编排得到的 assistant `reply` 发回当前单聊会话（`/send` 同源 `sendMessage`）。
 */
export async function reflowChatToChannel(pluginId: string, input: PluginExecuteCompletedInput): Promise<void> {
  const reply = String(input.reply ?? "").trim();
  if (!reply || reply.includes("(empty llm response)")) return;

  const md = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const accountIdRaw = md.accountId;
  const accountId =
    accountIdRaw != null && String(accountIdRaw).length > 0
      ? String(accountIdRaw)
      : accountIdFromSession(pluginId, input.sessionId);
  const to = md.wxReplyTo != null ? String(md.wxReplyTo).trim() : "";
  if (!accountId || !to) return;

  try {
    await sendMessage({ accountId, to, text: reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[weixin-bridge][${pluginId}] reflowChatToChannel failed: ${msg}`);
  }
}
