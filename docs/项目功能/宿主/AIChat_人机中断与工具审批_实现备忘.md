# AI Chat：人机中断与工具审批（SSE 单向下的实现备忘）

> 状态：设计备忘，**当前仓库未实现**专用「提交审批结果」接口；供后续接 `requires-action` / 工具审批、人工补全等能力时对照。

## 1. 问题：SSE 是单向的

- 浏览器通过 `POST /api/ai/chat` 建立流式响应后，**通道方向是服务端 → 客户端**（UIMessage chunk / SSE）。
- **不能**把用户的「同意 / 拒绝 / 填表结果」通过**同一条 SSE 连接**回传；协议上就不存在「客户端往这条流里写 body」的用法。

因此：流里可以出现 **工具待处理、中断、需人工确认** 等状态（例如 assistant-ui 中 `ToolCallMessagePart` 的 **结构化 `status`**，如 `type: "requires-action"` + `reason: "interrupt"`），但**把用户选择送回后端**必须走**第二次、由客户端主动发起的 HTTP 请求**。

## 2. 推荐实现模式：两阶段、双通道

| 阶段 | 方向 | 说明 |
|------|------|------|
| 阶段 A | 服务端 → 客户端 | 第一次 `POST /api/ai/chat` 开流；流与 part 中携带「需要用户操作」的语义（或专用 `data-*` part）。 |
| 阶段 B | 客户端 → 服务端 | 用户在 UI 上完成操作后，**新开请求**把结果交给宿主（见下文两种形态）。 |

**要点**：展示中断 UI 依赖阶段 A；**解除中断**依赖阶段 B，与 SSE 是否仍连接无关（可在流结束后单独 POST）。

## 3. 服务端回传用户结果的两种常见形态

### 3.1 再走一轮聊天消息（与现有路由对齐）

- 用户点击「确认」后，前端构造一条 **user `UIMessage`**（正文可为约定前缀 + JSON，或自然语言），再次 `POST /api/ai/chat`。
- 宿主编排（`orchestrateChat` / 信封解析）识别该消息为 **对挂起 `toolCallId` 的应答**，在服务端恢复上下文并继续执行（或等价于追加 tool result 后再调度）。

**优点**：不新增路由；会话 timeline 里可追溯。**缺点**：需在编排层定义清晰契约（防止与普通闲聊混淆）。

### 3.2 专用 REST 接口（适合强交互表单）

- 例如 `POST /api/ai/chat/tool-result`（路径仅为示例），body 携带 `pluginId`、`sessionId`、`runId` 或 `toolCallId`、`payload`（审批布尔 / 结构化字段）。
- 宿主在内存或 DB 中解析 **挂起的工具调用**，写入结果后继续同一逻辑 run 或触发下一轮。

**优点**：载荷清晰、易审计。**缺点**：需维护挂起状态与幂等；与 `AiRunProvider` 生命周期要对齐。

## 4. 与当前 wclaw 自带路由的关系（避免误用）

| 路由 | 实际用途 |
|------|----------|
| `POST /api/ai/chat` | 发送本轮用户消息并启动/接入编排与流式输出。 |
| `GET /api/ai/chat/resume-stream` | **断线重连**：订阅**已在跑的** `AiRun` 的 chunk 流（同 `pluginId` + `sessionId` 下的 active run），**不是**「提交审批结果」的通道。 |
| `POST /api/ai/chat/cancel` | 取消当前会话活跃 run。 |

实现人机中断时，**不要**把「用户审批 body」塞进 `resume-stream`；审批应答应使用 **§3** 的独立 POST 或第二条 chat 消息。

## 5. 前端（assistant-ui / AI SDK）侧通常做法

- 流式消息里 tool part 出现 **中断类 status** 时，由自定义 **Tool UI** 渲染按钮/表单。
- 用户提交后调用 **`useChat` / runtime** 提供的「提交工具结果」能力（若上游 SDK 支持），或项目侧封装为上述 **§3.1 / §3.2**。
- Vercel AI SDK 常见模式仍是：**下一条请求**的 `messages` 中带 **tool result** 或 continuation，而不是在同一条 SSE 上反向传输。

## 6. 可选：真双向实时

若产品要求极低延迟双向信令，可单独引入 **WebSocket**（或 SSE 仅用于推送 + 所有交互仍用 POST）。本备忘默认仍以 **HTTP + SSE** 为主栈。

## 7. 落地检查清单（后续开发自审）

- [ ] 挂起状态存在何处（进程内 / SQLite / Redis），进程重启是否可接受丢失。
- [ ] `toolCallId` / `runId` 与会话、`traceId` 的关联与超时清理。
- [ ] 第二次请求的幂等与防重放。
- [ ] 前端在「等待用户操作」期间是否禁用同会话并行发送（避免状态错乱）。
- [ ] 文档与 `chat_events` / 审计字段是否记录审批类事件。

## 8. 相关文档

- `docs/项目功能/消息流程/chat消息架构设计.md`（主链路、`PluginChatTransport`、`resume-stream`）
- `docs/项目功能/宿主/AIChat_UIMessageStream直通与可恢复会话_方案.md`（Run 与重连思路）
