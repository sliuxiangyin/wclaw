import type { UiChatMessage } from "./ai-chat.types.js";

/** 取最近一条用户可见正文（宿主编排入口单行 user） */
export function extractLastUserMessage(messages: UiChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content?.trim() ?? "";
}

/** 截断尾部 N 条非空消息，供 LLM 上下文窗口 */
export function buildWithContextWindow(messages: UiChatMessage[], limit: number) {
  return messages
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }))
    .filter((m) => m.content.trim().length > 0);
}
