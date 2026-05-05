# Notification SSE 长连接通知通道设计

## 1. 目标与背景

当前系统已有聊天相关流式能力，但缺少一个“全局常驻”的通知通道。新需求是增加一条独立的 SSE 长连接，用于前端持续接收后端推送的各类事件，而不依赖某次聊天请求的生命周期。

目标：

- 前端建立一次连接，持续接收通知（系统/调度/插件活动等）。
- 与 `POST /api/ai/chat` 的流式响应解耦，避免“请求结束即断流”。
- 支持按租户/用户/会话维度过滤事件，减少无关噪声。
- 提供最小可扩展事件协议，后续可平滑增加事件类型。

**与「宿主-插件通信总线（HPC Bus）」的边界（已确认）**：

| 文档 / 组件 | 职责 |
|-------------|------|
| **HPC Bus（`宿主-插件通信总线_*`）** | **插件 → 宿主**走统一 **Ingress API**；**Host Event Hub** 为唯一入站枢纽，再扇出到多个宿主内部消费者。 |
| **本文档（Notification SSE）** | 仅描述 **Hub 的一个下游 Sink**：浏览器长连接、`GET /api/notifications/stream`、连接治理与 scope 过滤。 |

- 插件**不**为 SSE 而设计 API；SSE **不是**总线本体。
- 当前仓库 v1 可能仍为「生产者 → `notification-bus.service.ts` → SSE」的过渡实现；**目标态**为「生产者 → **Host Event Hub** →（含本 SSE Sink 在内的）多 Sink」，详见《宿主-插件通信总线_设计文档.md》。
- **写死**：本通道**不**承接 `POST /api/ai/chat` 内 **`emitPluginActivity`** 流（**§0.2**）；宿主侧 **`publishToNotificationStream` / Hub `HOST_EVENT_TOPICS.Notification`** 与 **`ctx.publish`** 见《宿主-插件通信总线_设计文档》**§1**。

---

## 2. 总体方案

### 2.1 新增接口

- `GET /api/notifications/stream`（SSE）

请求参数（query）：

- `scope`: `global | plugin | session`（默认 `global`）
- `pluginId?`: 当 `scope=plugin/session` 时可用
- `sessionId?`: 当 `scope=session` 时可用
- `lastEventId?`: 用于断线重连补偿（可选，v1 可先不补历史）

请求头：

- `Accept: text/event-stream`

响应头：

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`

### 2.2 数据流

**目标态（与 HPC 对齐）**

1. 业务模块与插件仅向 **Host Event Hub** 入站（插件经 **Ingress API**）。
2. Hub 扇出到各 Sink；其中 **SSE Sink** 将允许透出的事件交给连接层。
3. 前端启动后创建 `EventSource` 到 `/api/notifications/stream`。
4. 后端为每个 SSE 连接注册对该 Sink 分发流的 subscriber（可为内存 `Set` + filter，即当前 `notification-bus` 角色）。
5. SSE 网关按连接 `scope` 过滤后推送给前端。
6. 前端按 `event` / `type` 路由到 UI（toast、时间线、状态角标等）。

**过渡态（v1）**：调度器等可能仍直接 publish 至 `notification-bus`；与 Hub 并存期间以改造文档为准逐步迁入。

---

## 3. 事件协议（v1）

统一 envelope（`data` JSON）：

```json
{
  "id": "evt_1746200000000_xxx",
  "type": "scheduler.task_failed",
  "ts": "2026-05-03T00:00:00.000Z",
  "scope": {
    "pluginId": "weixin-bridge",
    "sessionId": "weixin-bridge:account-xxx"
  },
  "level": "info",
  "payload": {}
}
```

字段说明：

- `id`: 事件唯一 ID（SSE `id:` 同步该值）
- `type`: 事件类型（见下）
- `ts`: 服务端时间
- `scope`: 路由维度
- `level`: `debug | info | warn | error`
- `payload`: 类型相关数据

建议首批 `type`：

- `system.notice`
- `scheduler.task_started`
- `scheduler.task_succeeded`
- `scheduler.task_failed`
- `plugin.activity`（非聊天上下文也可推送）
- `plugin.account_status_changed`

---

## 4. 后端实现设计（host-api）

### 4.1 模块职责

- `services/notification/notification-bus.service.ts`（v1）
  - **SSE Sink 背后的**内存 `publish` / `subscribe` + `scope` 过滤。
  - **非**插件语义上的「宿主接收中心」；目标态下可由 **Host Event Hub** 扇出调用，或保留为 Sink 内部实现。

- `services/notification/notification-schema.ts`
  - 定义 `NotificationEvent` 类型与校验

- `routes/notification.routes.ts`
  - 注册 `GET /api/notifications/stream`

### 4.2 与现有模块集成

- Scheduler 在关键节点 publish：
  - task 启动/成功/失败
- Plugin Chat / Runtime 在适当阶段 publish：
  - 账号状态变化、异步错误
- 错误处理层可选 publish `system.notice`

### 4.3 连接治理

- 心跳：每 15s 发送注释行 `: ping\n\n`
- 客户端断开时自动取消订阅
- 单连接背压保护：超限直接断开并记录 warn

---

## 5. 前端实现设计（host-console）

新增：

- `src/features/notifications/runtime/notification-sse-client.ts`
  - 封装 `EventSource`、重连、onmessage 分发

- `src/features/notifications/context/notification-context.tsx`
  - 提供全局状态与订阅接口

- `src/features/notifications/hooks/use-notification-stream.ts`
  - 页面级消费 hook

UI 建议：

- 轻通知（toast）
- 插件页右上角状态条（最近错误）
- Chat 时间线可选接入 `plugin.activity`（与已有活动流并存）

---

## 6. 分阶段落地

### Phase 1（MVP）

- 打通 `/api/notifications/stream`
- 支持 `system.notice` 与 `scheduler.task_*`
- 前端控制台打印 + 简单 toast

### Phase 2

- 接入 `plugin.activity` 与 `plugin.account_status_changed`
- 支持 scope 过滤与插件页局部订阅

### Phase 3

- 增加断线补偿（`Last-Event-ID` + 短时缓存）
- 完善监控指标（连接数、丢弃数、重连率）

---

## 7. 风险与约束

- 内存总线跨进程不可见：多实例部署需升级到外部 Hub/总线（Redis/NATS）。
- 不应把高频原始日志直接推 SSE，需聚合/降采样。
- 事件 payload 需脱敏，避免 token、隐私字段外泄。
- **背压**：无对外开放的事件 API，仍可能存在进程内高频事件与**浏览器读慢**导致的 SSE 写端积压；须保留单连接保护、节流与断开策略（见 §4.3）。

---

## 8. 验收标准（DoD）

- 前端打开后可稳定保持 SSE 连接，断网可自动重连。
- 后端 Scheduler 事件可在前端实时看到。
- 插件维度事件可按 `pluginId` 过滤。
- 不影响现有聊天流式能力，接口兼容。

