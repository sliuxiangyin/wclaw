# AI Chat：UIMessage Stream 直通与可恢复会话（单机内存版）

## 1. 目标与范围

本方案用于替换当前自定义 SSE chunk 协议，改为：

1. **主通道直通**：后端使用标准 `ai-sdk/openai + assistant-ui` UIMessage Stream 协议直通前端。  
2. **可恢复会话**：页面刷新/断开连接后，不中断正在运行的 LLM 任务；前端可按 `runId` 重连继续接收。  
3. **迁移顺序**：先完成主通道与可恢复能力，再迁移 plugin 相关逻辑（`plugin-activity`、自定义 trace、旧历史重建）到新协议。  
4. **执行层归位**：后台运行管理放在 `apps/host-api/src/providers/`。

> 本阶段**不考虑旧协议兼容**，按新协议一次性切换。

---

## 2. 现状问题（为何要改）

- 自定义 chunk 映射复杂，`fullStream` 事件类型变动易导致 text/tool 丢失。
- 流式与历史重放存在双轨逻辑，易出现“实时与刷新后不一致”。
- 前端刷新会中断当前 HTTP 请求，导致 LLM 任务中断（请求生命周期绑定运行生命周期）。

---

## 3. 目标架构

### 3.1 双层解耦

- **执行层（Run Engine）**：独立后台任务（与浏览器连接解耦）。
- **传输层（Stream Delivery）**：SSE 仅负责订阅某个运行任务的事件流，可断线重连。

### 3.2 Providers 层职责

新增 provider（建议）：

- `providers/ai-run-provider/ai-run-registry.provider.ts`
  - `Map<runId, RunState>`
  - run 生命周期：`queued/running/completed/failed/cancelled`
  - `AbortController` 管理取消
- `providers/ai-run-provider/ai-run-event-buffer.provider.ts`
  - 每个 run 的 event ring buffer（含 `seq`）
  - 支持从 `lastSeq` 回放
- `providers/ai-run-provider/ai-run-publisher.provider.ts`
  - 将 UIMessage chunk 广播给订阅者
  - 同步写入 event buffer

> 单机内存版仅保证“同进程可恢复”，不保证服务重启恢复。

---

## 4. 协议设计（新）

### 4.1 Run 资源

- `POST /api/ai/runs`
  - 入参：`pluginId/sessionId/messages/model`
  - 出参：`runId`、初始状态
  - 行为：创建并启动后台 run

- `GET /api/ai/runs/:runId/stream?lastSeq=<n>`
  - SSE 订阅 run 事件
  - 先补发 `seq > lastSeq` 缓存事件，再推送实时事件

- `POST /api/ai/runs/:runId/cancel`
  - 手动停止 run

- `GET /api/ai/runs/:runId`
  - 查询状态与进度

### 4.2 事件载荷

事件 payload 使用标准 UIMessage chunk（text/reasoning/tool/data/start/finish）。  
不再自定义 `toUiMessageChunk` 映射。

---

## 5. plugin-activity / data-trace / 历史落库

### 5.1 plugin-activity

- 改为标准 `data-*` part：`type: data-plugin_activity`
- 前端用 `MessagePrimitive.Parts` 的 data 渲染（或 `makeAssistantDataUI`）

### 5.2 data-trace

- 改为 `type: data-trace`
- 默认不展示，可用于诊断/审计

### 5.3 历史落库（旁路写入）

后台 run 在推送 chunk 时，同步做一份“旁路持久化”：

- `chat_messages`：user/assistant 最终消息
- `chat_message_parts`（或事件表）：按 `runId + seq` 存 chunk

页面刷新历史时，直接按 part 重建 UIMessage，避免二次推测。

---

## 6. 前端改造要点

- `PluginChatTransport.sendMessages` 改为：
  1) `create run`
  2) 订阅 `run stream`
- `reconnectToStream()` 实现：
  - 持有最近 `runId` 与 `lastSeq`
  - 刷新后重连并补齐
- 删除旧自定义解析：
  - `parseSseBlock` / `toUiMessageChunk` 旧桥接代码

---

## 7. 实施阶段

### Phase A：主通道直通（不迁移 plugin 扩展）

- 后端 run 管理（providers）
- 新 `/api/ai/runs` + `/stream` + `/cancel` 路由
- 前端按 run 订阅与重连

### Phase B：迁移 plugin-activity 与 trace

- `plugin-activity` -> `data-plugin_activity`
- `data-trace` -> `data-trace`
- 前端 data part UI

### Phase C：历史落库与重放一致性

- run 事件落库
- timeline 按 part 重建
- 删除旧的“摘要重建/兼容逻辑”

---

## 8. 验收标准（DoD）

1. 页面刷新后，未取消 run 持续执行；重连后可继续收到新 chunk。  
2. 同一 run，实时展示与刷新历史展示一致（text/tool/reasoning/data）。  
3. 支持并发多 run（同机内存版）。  
4. 点击停止可中断后台 run。  
5. 删除旧自定义 chunk 桥接后，主链路仍稳定。

---

## 9. 非目标（本阶段）

- 多实例共享运行状态（需 Redis/DB + pubsub）
- 服务重启后的 run 恢复
- 旧协议兼容双写
