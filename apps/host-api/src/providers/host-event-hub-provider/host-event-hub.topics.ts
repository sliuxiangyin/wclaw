/**
 * Host Event Hub：逻辑 topic 常量（与 SSE event type / 业务命名解耦，用于路由）。
 */
export const HOST_EVENT_TOPICS = {
  /** 常驻 Notification SSE（经 NotificationProvider → 订阅者） */
  Notification: "hpc.notification",
  /**
   * 前端 Toast / 轻提示（与 Notification 同一条 SSE，经同一 Bridge `dispatch`；`event.type` 建议用 `ui.toast`）。
   * 插件经 `publish({ topics: [HOST_EVENT_TOPICS.Toast], notification })` 投递。
   */
  Toast: "hpc.toast",
  /** 预留：聊天侧扇出等 */
  Chat: "hpc.chat"
} as const;

export type HostEventTopic = (typeof HOST_EVENT_TOPICS)[keyof typeof HOST_EVENT_TOPICS];
