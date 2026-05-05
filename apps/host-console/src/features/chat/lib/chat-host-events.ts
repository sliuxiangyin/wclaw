/** 与宿主 SSE `event: chat.session.updated` 对齐，供 `useNotificationStream` 派发、`usePluginChatTimelineBootstrap` 订阅。 */
export const CHAT_SESSION_UPDATED_EVENT = "wclaw:chat-session-updated";

export type ChatSessionUpdatedDetail = {
  pluginId: string;
  sessionId: string;
  reason?: string;
};
