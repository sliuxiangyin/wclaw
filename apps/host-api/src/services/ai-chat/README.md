# AI Chat 编排模块（`services/ai-chat`）

本目录实现 **`POST /api/ai/chat` 业务内核**：在 **会话态**（`chat_sessions`：normal / isolated）与 **用户末条消息** 下，将请求路由到 **command_plugin**、**runtime_plugin 插件对话** 或 **宿主 LLM**，并 **统一落库** `plugin_chat_messages` / 写 `chat_events`。

---

## 文件一览

| 文件 | 职责 |
|------|------|
| **`ai-chat.service.ts`** | 对外入口 `orchestrateChat`：校验宿主插件、落 user、拉会话态、**resolve → dispatch**、落 assistant、写 `chat.response.completed`。 |
| **`../register-plugin/external-user-turn.service.ts`** | `createIngestExternalUserTurnForPlugin`：拼 `messages` + `orchestrateChat`；成功后再 **鸭子调用 `reflowChatToChannel`**（可选），然后 `notifyChatSessionUpdated`；闭包注入见 **`composition/register-plugin-ingest-and-host-bridge.ts` + `setIngestExternalUserTurn`**。 |
| **`ai-chat.types.ts`** | 输入/输出、`ChatBranchResult`、`AiOrchestrationContext`、`ExecuteCommandPluginInput` 等类型。 |
| **`ai-chat-resolution.ts`** | **纯判别**（无 IO）：`resolveAiOrchestrationPath` → `AiOrchestrationPath` 联合类型。 |
| **`ai-chat-dispatch.ts`** | **唯一集中 `switch`**：`dispatchAiOrchestration(path, ctx)` 调用各分支实现。 |
| **`ai-chat-isolated.ts`** | 隔离模式：`/close` 写回 normal；否则将全文转发为子插件命令。 |
| **`ai-chat-host-command.ts`** | 宿主 `/command <pluginId>…`：解析目标清单、**isolated_chat** 入隔离或 **瞬时** `executeCommandPlugin`。 |
| **`ai-chat-runtime-default.ts`** | 普通 runtime 路径：多会话默认引导、插件内 `/` 命令、`sendPluginChat(delegatedPersistence)`、否则 LLM。 |
| **`ai-chat-command-plugin.ts`** | `executeCommandPlugin` + `resolveCommandPluginMode`；ephemeral 带/不带 LLM。 |
| **`ai-chat-command-envelope.ts`** | `/command` 文本解析（与插件内斜杠命令区分）。 |
| **`ai-chat-context-window.ts`** | `extractLastUserMessage`、`buildWithContextWindow`。 |
| **`ai-chat-events.util.ts`** | LLM 失败等事件小工具（`appendLlmFailedEvent`）。 |

---

## 依赖方向（须保持）

```
ai-chat.service
  → resolution, dispatch, repositories, plugin-catalog

ai-chat-dispatch
  → isolated, host-command, runtime-default, types
  ← 不依赖 fastify / routes

ai-chat-isolated / ai-chat-host-command / ai-chat-runtime-default
  → command-plugin、plugin-chat、llm、repositories
```

禁止本目录内文件依赖 `routes/`、`controllers/`。

---

## 编排流程（阅读代码顺序）

1. **`orchestrateChat`** 写入本轮 **user** 行，打 `chat.request.received`。
2. **`resolveAiOrchestrationPath(state, userMessage)`**  
   - 若在 **isolated** 且非 `/close` → `isolated_delegate`；`/close` → `isolated_close`。  
   - 否则若匹配 **`/command`** 且无 pluginId → `host_bad_format`；有 → `host_command`。  
   - 否则 → `runtime_default`。
3. **`dispatchAiOrchestration`** 按路径执行，返回 **新 `state`（可能已改隔离）** + **`ChatBranchResult`**。
4. **`orchestrateChat`** 用分支结果 **写 assistant 行**（含 `sourceType` / `llmEligible` / `contextSummary`），打 `chat.response.completed`。

---

## 与 `plugin-chat.service` 的关系

- **`sendPluginChat({ delegatedPersistence: true })`** 仅由 **`ai-chat-runtime-default`** 在 **被 `orchestrateChat` 调用** 时使用，避免与宿主 **重复写入** 同一条 user/assistant。  
- 独立入口 **`POST /api/plugins/:id/chat`** 仍走 **`sendPluginChat`** 全量持久化（不传 `delegatedPersistence`）。

---

## 并发与会话队列（新增约束）

- `orchestrateChat` 的执行单元应采用 **按会话串行队列**（session-level queue）：
  - 队列 key：`pluginId + sessionId`
  - 同 key 请求：严格 FIFO 串行，避免状态竞争和消息乱序
  - 不同 key 请求：允许并行，保持系统吞吐
- 该约束的目标：
  - 防止 Web 通道与微信通道同时命中同会话时出现竞态
  - 保证 `chat_sessions` 状态切换（`normal/isolated`）不被并发覆盖
  - 保证 `plugin_chat_messages` 的 user/assistant 落库顺序稳定
- 当前阶段为单进程内队列；若后续多实例部署，需升级为分布式锁/租约实现。

---

## 维护说明

- 新增一条 **顶层分支**：先扩展 **`AiOrchestrationPath`** 与 **`resolveAiOrchestrationPath`**，再在 **`dispatchAiOrchestration`** 增加 `case`，避免在 `orchestrateChat` 再堆 `if/else`。  
- 与消息语义相关的文档可对照仓库内 `docs/项目功能/消息流程/` 下 runtime / command_plugin 流程说明。
