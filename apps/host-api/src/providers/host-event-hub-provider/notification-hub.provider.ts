import type { NotificationProvider } from "../notification-provider/index.js";
import type { HostHubProvider, HostHubPublishInput, HostHubRegistrar } from "./host-event-hub.js";
import { HOST_EVENT_TOPICS } from "./host-event-hub.topics.js";

/**
 * Notification = Hub 的一个 Provider（Bridge）：在 `attach` 中注册 Sink，将 Hub 入站转为 `NotificationProvider.dispatch`。
 */
export function createNotificationHubBridge(notification: NotificationProvider): HostHubProvider {
  return {
    id: "notification",
    attach(registrar: HostHubRegistrar) {
      const sink = (input: HostHubPublishInput) => {
        if (!input.notification) return;
        notification.dispatch(input.notification);
      };
      registrar.registerSink(HOST_EVENT_TOPICS.Notification, sink);
      registrar.registerSink(HOST_EVENT_TOPICS.Toast, sink);
      registrar.registerSink(HOST_EVENT_TOPICS.Chat, sink);
    }
  };
}
