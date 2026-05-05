# host-event-hub-provider（Host Event Hub）

| 概念 | 职责 | 位置 |
|------|------|------|
| **Host Event Hub** | 维护 topic→Sink、`publish`、`registerProvider`。 | `host-event-hub.ts`（**class `HostEventHub`**） |
| **Notification Bridge** | 实现 `HostHubProvider`，把 **`Notification` / `Toast` / `Chat`** topic 转给同一 `NotificationProvider.dispatch`（SSE 以 `notification.type` 区分，如 `ui.toast`、`chat.session.updated`）。 | `notification-hub.provider.ts`（`createNotificationHubBridge`） |
| **常驻 SSE 领域** | 订阅与投递实现。 | `../notification-provider/` |

## 组装（组合根）

在 `app.ts` / `createApp`：`new NotificationProvider()` → **`new HostEventHub(notificationProvider)`**（内部自动注册 Notification Bridge）→ **`hostEventHub.createPublishNotificationStream()`** 等。其它域仍 **`hub.registerProvider(...)`**。

## 扩展新域

1. 在 `providers/host-event-hub-provider/` 增加 `createXxxHubBridge(...)` 返回 `HostHubProvider`。
2. 在 **`createApp`**（或 Hub 构造扩展）中追加 `hub.registerProvider(...)`。
3. 新 topic：在 `host-event-hub.topics.ts` 的 `HOST_EVENT_TOPICS` 中增加常量。

## 分层

- **`host-event-hub.ts`**：可对 `NotificationEvent` 使用 **`import type`**；禁止 `import` 通知运行时实现。
- **Bridge 文件**：可 import Hub 类型与 `NotificationProvider`，完成接线。

设计文档：`docs/项目功能/宿主插件通信总线/host-event-hub_providers_设计.md`
