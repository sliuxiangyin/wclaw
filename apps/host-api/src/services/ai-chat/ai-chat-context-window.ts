import type { UiChatMessage } from "./ai-chat.types.js";

/** 取最近一条用户可见正文（宿主编排入口单行 user） */
export function extractLastUserMessage(messages: UiChatMessage[]): string {
  return [...messages]
    .reverse()
    .map((m) => ({ role: m.role, content: buildLlmContentFromUiMessage(m) }))
    .find((m) => m.role === "user")
    ?.content?.trim() ?? "";
}

/** 截断尾部 N 条消息，保留 role 边界；仅移除纯空 user 噪声 */
export function buildWithContextWindow(messages: UiChatMessage[], limit: number) {
  return messages
    .slice(-limit)
    .map((m) => ({ role: m.role, content: buildLlmContentFromUiMessage(m) }))
    .filter((m) => !(m.role === "user" && m.content.trim().length === 0))
    .map((m) => ({
      role: m.role,
      content: m.content.trim().length > 0 ? m.content : `[${m.role} empty]`
    }));
}

function buildLlmContentFromUiMessage(message: UiChatMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (parts.length === 0) return message.content ?? "";

  const textLines: string[] = [];
  for (const p of parts) {
    const part = p as Record<string, unknown>;
    const t = typeof part.type === "string" ? part.type : "";
    if (t === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
      textLines.push(part.text.trim());
    }
  }

  const merged = textLines.join("\n").trim();
  return merged.length > 0 ? merged : (message.content ?? "");
}

/**
 * 旧历史可能包含手工序列化的工具痕迹。新链路以 UIMessage.parts 为权威，
 * 这里仅作为保护层，避免旧文本重新进入模型上下文。
 */
export function stripAssistantSerializedTracesForLlm(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("[tool") && !t.startsWith("[reasoning]");
    })
    .join("\n")
    .trim();
}

const EMPTY_ASSISTANT_AFTER_STRIP = "[历史 assistant 消息中仅含已省略的工具摘要行]";

/** 对窗口内 assistant 正文做剥离；剥离后为空时占位，避免破坏消息结构。 */
export function sanitizeMessagesForLlmWindow<T extends { role: string; content: string }>(rows: T[]): T[] {
  return rows.map((m) => {
    if (m.role !== "assistant") {
      return m;
    }
    const c = stripAssistantSerializedTracesForLlm(m.content);
    return { ...m, content: c.length > 0 ? c : EMPTY_ASSISTANT_AFTER_STRIP } as T;
  });
}
