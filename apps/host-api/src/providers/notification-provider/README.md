# notification-provider

| 文件 | 职责 |
|------|------|
| `notification-provider.ts` | **class `NotificationProvider`**：`subscribe`、`dispatch`（由 Hub Bridge Sink 调用）。 |
| `notification.types.ts` | 对 `core/notification.types.ts` 的 re-export（类型单源在 core，供 services 引用）。 |

经 Hub 发布：`HostEventHub#createPublishNotificationStream()`（见 `../host-event-hub-provider/host-event-hub.ts`）。业务勿直调 `dispatch` 绕过 Hub。
