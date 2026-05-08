import type { UiChatMessage } from "./ai-chat.types.js";

/** 取最近一条用户可见正文（宿主编排入口单行 user） */
export function extractLastUserMessage(messages: UiChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
}

/** 截断尾部 N 条消息，保留 role 边界；仅移除纯空 user 噪声 */
export function buildWithContextWindow(messages: UiChatMessage[], limit: number) {
  return messages
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }))
    .filter((m) => !(m.role === "user" && m.content.trim().length === 0))
    .map((m) => ({
      role: m.role,
      content: m.content.trim().length > 0 ? m.content : `[${m.role} empty]`
    }));
}
