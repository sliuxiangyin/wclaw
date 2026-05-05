# 微信桥（weixin-bridge）接口契约（v3）

本文描述 **`plugins/weixin-bridge`** 外层运行时与**宿主通用插件 API**的对应关系；**不**规范内嵌子项目 `openclaw-weixin` 的内部接口（以其仓库与构建产物为准）。

关联文档：

- 外部进线与编排：`进度/外部进线-ingest检查清单.md`
- 插件运行时形状：`插件/插件运行时导出方法.md`
- 类型契约：`packages/plugin-sdk`（`ExternalUserTurnInput`、`ChatReflowToChannelInput`、`PluginRuntimeExtensionDeps`）

---

## 1. 宿主侧通用 HTTP（无微信专用路由）

| 能力 | 方法 | 路径 |
|------|------|------|
| 插件 Chat | `POST` | `/api/plugins/:pluginId/chat` |
| 会话列表 | `GET` | `/api/plugins/:pluginId/sessions` |
| 切换会话 | `POST` | `/api/plugins/:pluginId/sessions/:sessionId/switch` |
| 会话消息时间线 | `GET` | `/api/plugins/:pluginId/sessions/:sessionId/messages` |
| 插件命令 | `POST` | `/api/plugins/:pluginId/command` |

其中 `:pluginId` 对微信桥为清单中的 `id`（当前为 `weixin-bridge`）。

---

## 2. Chat 协议（账号会话）

- **`sessionProvider.mode = multi`**：默认会话仅登录引导；**账号会话** `sessionId` 约定为 `weixin-bridge:account:<accountId>`（与 `runtime/session-state.mjs` 一致）。
- 用户在 Chat 输入框发送的文本由宿主路由至插件 **`handleChat`**；登录进度等可走 **`emitPluginActivity`** / SSE，与 HPC 规则一致。
- 欢迎语等需落库时由 **`handleChat` 返回 `persist`**，由宿主 **`sendPluginChat`** 校验 `sessionId` 后写入，插件不提供 `appendMessage`。

---

## 3. 调度任务 `poll-inbox`

- 由插件 **`getScheduledTasks`** 声明，宿主 Scheduler 按 **`intervalMs`** 等字段触发 **`runScheduledTask('poll-inbox', ctx)`**。
- 单次 tick 内调用适配器拉取新消息；**禁止**在外层 `runtime` 内裸 `while(true)` 常驻轮询。

### 3.1 外部进线 `ingestExternalUserTurn`（账号会话）

当宿主向 runtime 构造体注入了 **`ingestExternalUserTurn`**（仅 `runtime_plugin`）时，`poll-inbox` 可对本轮 **inbound** 调用该闭包，走与 **`POST /api/ai/chat`** 同源的 **`orchestrateChat`** 编排。

**`userText` 口径（重要）**

- 仅拼接对方消息的 **`text`** 字段（去首尾空白、去空行后 `join("\n")`）。
- **不得**把微信侧 `userId`（如 `xxx@im.wechat`）前缀拼进 `userText`，以免污染模型输入与 UI 展示。

**`metadata` 口径（微信回流）**

- **`accountId`**：当前轮询账号。
- **`wxReplyTo`**：取本轮 inbound **最后一条**的对方 `userId`，供编排成功后 **`reflowChatToChannel`** 调用 **`sendMessage`** 时定位回复对象。
- 其他字段（如 `messageCount`、`source`）以实现为准，宿主会原样传入 **`ChatReflowToChannelInput.metadata`**。

### 3.2 通知与 Toast（Hub）

`receiveNewMessages` 经 **`ctx.publish`** 推送预览时：

- **inbound**：行内容为 **`时间戳 + 正文`**，不把 `userId` 写入可读串。
- **outbound**（本账号发出）：行内容为 **`时间戳 + 我: 正文`**（`outbound` = 出站 = 我方发出）。

通知 payload 仍带 `accountId`、`messageCount`、`lines` 等，供管理台或后续 UI 消费。

---

## 4. 编排成功后的渠道回流 `reflowChatToChannel`

- 插件可选实现 **`reflowChatToChannel(input)`**（见 `@wclaw/plugin-sdk`）。
- 宿主在 **`orchestrateChat` 成功之后**、**会话更新通知之前**鸭子调用；失败**不回滚**已落库的 assistant 消息。
- 微信桥实现：读取 **`metadata.accountId`**、**`metadata.wxReplyTo`**，将 **`input.reply`** 作为微信侧发送内容。

---

## 5. 变更记录

- **2026-05-03**：补齐契约文档；对齐「纯 `userText`」「`wxReplyTo` 在 metadata」「通知预览不含 inbound 的 userId」等实现口径。
