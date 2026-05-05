# 外部进线 `ingestExternalUserTurn` 检查清单

与实现：`PluginRuntimeExtensionDeps.ingestExternalUserTurn`、`external-user-turn.service.ts`、`hpc.chat` → Notification SSE `chat.session.updated`、微信 `poll-inbox` 调用。

**契约口径**：`../weixin_bridge_api_contract_微信桥接口契约.md`（微信侧 `userText` / `metadata` / 通知预览）。

## 数据口径（微信 `poll-inbox`）

| 字段 | 说明 |
|------|------|
| **`ingestExternalUserTurn.userText`** | 仅 inbound 的 **`msg.text`**（trim、过滤空串、`join("\n")`），**不含** `userId` 前缀 |
| **`metadata.wxReplyTo`** | 本轮 inbound **最后一条**的对方 `userId`，供 `reflowChatToChannel` → `sendMessage` |
| **`metadata.accountId`** | 当前微信账号，与 `sendMessage` 一致 |
| **通知 / Toast `lines`** | inbound 为「时间 + 正文」；outbound 为「时间 + 我: 正文」（不把对方 id 拼进可读串） |

单次 tick 内顺序：**先** `maybeIngestInboundForAccount`（编排），**再** `receiveNewMessages`（Hub 通知），避免 UI 先于落库刷新时缺少本轮消息（仍依赖前端对 `chat.session.updated` 的 reload）。

## 已实现（P0）

- [x] SDK 契约：`ExternalUserTurnInput` / `ExternalUserTurnResult` / 可选 `ingestExternalUserTurn`
- [x] 宿主：每次调用 `listChatMessagesTail` 拼 `messages`，末尾追加本轮 `userText`，再 `orchestrateChat`
- [x] 默认会话 `pluginId:default` 拒绝外部进线
- [x] `runtime_plugin` 注入 `ingest`；`command_plugin` 不注入
- [x] 组合根：`PluginRuntimeProvider.create` 后 **`setIngestExternalUserTurn`**（`app.ts` 闭包调用 `createIngestExternalUserTurnForPlugin` + `hostEventHub.publish`）；`providers` **不** import `services/ai-chat`
- [x] 编排成功后：若插件实现 **`reflowChatToChannel`**（方案 A：`ChatReflowToChannelInput`）则先于 UI 通知调用；微信桥用 `metadata.wxReplyTo` + `sendMessage` 回流
- [x] 编排成功后 `publish(hpc.chat)` + `notification.type = chat.session.updated`
- [x] 前端：SSE 订阅 `chat.session.updated` → `window` 自定义事件 → `usePluginChatTimelineBootstrap.reload()`

## 待办 / 风险（按优先级）

### P1 — 幂等与重复轮询

- [ ] `dedupeKey`（如微信 msgId）+ 宿主短期去重或表约束，避免同一条 inbound 触发两轮编排

### P1 — 调度超时

- [ ] `poll-inbox` 的 `timeoutMs`（如 8000）若小于 LLM 最坏耗时，会导致任务失败重试；按需调大或拆「入队 + worker」

### P2 — 编排语义

- [ ] 隔离态 / `/command` 与外部 `userText` 同会话混用时的 `resolve` 策略（是否引入 `ingress: external` 参与分支）

### P2 — 观测

- [ ] `appendChatEvent` 中附带 `source.kind = weixin.inbound`（当前 `metadata` 仅经 `chat.session.updated` payload 透传）

### P2 — 独立 Chat SSE

- [ ] 从 Notification 通道拆出专用 `/api/chat/stream`，减轻事件混流

## 手动验证建议

1. 登录微信账号会话，向该账号发一条 inbound，确认 DB 出现 user + assistant，控制台当前会话历史自动刷新。
2. 默认会话调用 `ingest`（若插件误调）应返回 `DEFAULT_SESSION` 类错误且不写库。
3. 修改 LLM 设置页模型后，再触发 inbound，确认使用新模型（`getLlmConfig` 每次 LLM 调用读取）。
