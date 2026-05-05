import type { NotificationEvent } from "../../core/notification.types.js";

type NotificationFilter = {
  scope?: "global" | "plugin" | "session";
  pluginId?: string;
  sessionId?: string;
};

type Subscriber = {
  filter: NotificationFilter;
  onEvent: (event: NotificationEvent) => void;
};

function matchesFilter(event: NotificationEvent, filter: NotificationFilter): boolean {
  if (!filter.scope || filter.scope === "global") return true;
  if (filter.scope === "plugin") {
    return event.scope?.pluginId === filter.pluginId;
  }
  if (filter.scope === "session") {
    return event.scope?.pluginId === filter.pluginId && event.scope?.sessionId === filter.sessionId;
  }
  return true;
}

/**
 * 常驻 Notification SSE 订阅与投递。**不得**在构造时注入 `HostEventHub` 或其它 Provider；经 Hub 的送达由 `createNotificationHubBridge` 在组合根注册 Sink。
 */
export class NotificationProvider {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(filter: NotificationFilter, onEvent: (event: NotificationEvent) => void): () => void {
    const subscriber: Subscriber = { filter, onEvent };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * 由 Host Event Hub 的 Notification Bridge Sink 调用；业务侧请经 Hub `publish` 或 `HostEventHub#createPublishNotificationStream()`。
   */
  dispatch(input: Omit<NotificationEvent, "id" | "ts"> & { id?: string; ts?: string }): void {
    const event: NotificationEvent = {
      id: input.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: input.ts ?? new Date().toISOString(),
      type: input.type,
      level: input.level,
      scope: input.scope,
      payload: input.payload
    };
    for (const sub of this.subscribers) {
      if (!matchesFilter(event, sub.filter)) continue;
      try {
        sub.onEvent(event);
      } catch {
        // 单订阅者异常不影响其他订阅者
      }
    }
  }
}
