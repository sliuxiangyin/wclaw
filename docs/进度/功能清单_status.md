# 功能清单 status（基于 docs + code）

更新时间：2026-05-03

本文作为宿主能力与进度的统一主清单，按四大模块维护：

- 插件（Plugin）
- 调度与编排（Scheduler / Orchestration）
- LLM 配置（LLM Config）
- Chat（会话与消息流）

状态标记：

- `✅` 已实现
- `🔳` 未完成

关联文档：

- 执行任务清单：`任务TODO.md`
- 宿主能力说明：`../项目功能/宿主/宿主功能.md`
- Scheduler 需求与设计：`../项目功能/Scheduler调度器_需求与设计方案.md`

同步维护规则：

1. 本文只维护“能力完成度”（功能视角），不拆执行步骤。
2. 完成度变化后，必须同步回填 `任务TODO.md` 的任务状态。
3. 每周至少一次按代码现状核对并更新日期。

---

## 1) 插件（Plugin）

### 已实现

- ✅ 插件扫描与基础加载（基于 `plugins/*/plugin.json`）
- ✅ 插件目录与详情：`GET /api/plugins`、`GET /api/plugins/:pluginId`
- ✅ 插件配置：`GET/PUT /api/plugins/:pluginId/config`
- ✅ 插件配置校验占位：`POST /api/plugins/:pluginId/config/validate`（当前固定返回 `valid: true`）
- ✅ 插件规范校验：`POST /api/plugins/:pluginId/validate`
- ✅ 插件 chat 与 command：
  - ✅ `GET /api/plugins/:pluginId/sessions`
  - ✅ `POST /api/plugins/:pluginId/sessions/:sessionId/switch`
  - ✅ `POST /api/plugins/:pluginId/chat`
  - ✅ `POST /api/plugins/:pluginId/command`
- ✅ `weixin-bridge`：`plugin.json` + `runtime.mjs`；内嵌 `openclaw-weixin`（构建产物 `dist`）；真实扫码登录链路；`getScheduledTasks` 任务 `poll-inbox` 单次拉取；`/login` 进度经 SSE **`plugin-activity`**；账号会话欢迎语经 **`persist` 由宿主落库**；inbound 经 **`ingestExternalUserTurn`** 进编排（`userText` 仅为对方正文）；编排成功后 **`reflowChatToChannel`** + `metadata.wxReplyTo` 微信回流；契约见 **`../weixin_bridge_api_contract_微信桥接口契约.md`**
- ✅ `workspace-echo` 已补齐 `dist/index.js`，可作为 command_plugin 运行
- ✅ 已新增两个测试插件：
  - ✅ `test-runtime-ping`（runtime_plugin，含调度任务）
  - ✅ `test-command-echo`（command_plugin，可执行命令）

### 未完成

- 🔳 插件配置校验仍为占位逻辑，需升级为 schema + 语义双校验
- 🔳 前后端分层规范需在新增代码中持续收敛执行
- 🔳 微信桥：登录取消/状态查询命令、生产级错误与用户提示；进线 **幂等**（`dedupeKey` / 去重）与待办项见 **`进度/外部进线-ingest检查清单.md`**

---

## 2) 调度与编排（Scheduler / Orchestration）

### 已实现

- ✅ Chat 侧具备基础编排能力（统一入口接入并分发执行路径）
- ✅ 编排架构文档已形成（Orchestration / Execution / Session / Persistence 分层）
- ✅ Scheduler 专项需求与设计方案已形成（v1）
- ✅ 编排租约接口已落地：
  - ✅ `POST /api/orchestration/lease/grant`
  - ✅ `POST /api/orchestration/lease/revoke`
- ✅ Scheduler 主链路已落地（registry + runner + observer + circuit-breaker + lease）
- ✅ 已接管 runtime_plugin 定时任务（当前以 `weixin-bridge` 为运行实例）
- ✅ 并发上限、超时、退避、重试、熔断已形成统一实现（v1）
- ✅ 调度状态查询接口已落地：`GET /api/orchestration/scheduler/status`

### 未完成

- 🔳 `safe_mode` 降级策略仍是最小态，需补齐触发后能力收敛与恢复策略
- 🔳 调度相关自动化测试缺失（service/route）

---

## 3) LLM 配置（LLM Config）

### 已实现

- ✅ LLM 配置查询：`GET /api/llm/config`
- ✅ LLM 配置更新：`PUT /api/llm/config`
- ✅ host-console 已接入 LLM 设置页（`/settings/llm`）

### 未完成

- 🔳 多模型路由策略（按插件/场景选择模型）
- 🔳 更细粒度参数治理（token、温度、超时等）
- 🔳 配置变更审计与回滚机制

---

## 4) Chat（会话与消息流）

### 已实现

- ✅ `POST /api/ai/chat`（支持普通 JSON 响应）
- ✅ `POST /api/ai/chat`（Accept 为 `text/event-stream` 时支持 SSE chunk）
- ✅ `GET /api/ai/events`（事件查询）
- ✅ 同会话串行编排队列（session-level queue，`pluginId+sessionId`）
- ✅ 插件 chat 页面与路由：
  - ✅ `/chat/:pluginId`
  - ✅ 已接入 `assistant-ui`
- ✅ 消息流程文档已覆盖 runtime_plugin / command_plugin 多模式
- ✅ 多会话 `runtime_plugin` 默认会话：`POST /api/ai/chat` 路径下非斜杠消息不走 LLM，回落插件 `handleChat`（便于默认会话仅展示登录引导）
- ✅ 外部进线：宿主向 `runtime_plugin` 注入 **`ingestExternalUserTurn`**；编排成功后可选 **`reflowChatToChannel`**；`hpc.chat` → **`chat.session.updated`**；前端 SSE 触发时间线 **`reload()`**（见 **`进度/外部进线-ingest检查清单.md`**）

### 未完成

- 🔳 生产级 SSE 事件规范仍需补齐（事件命名与 payload 统一）
- 🔳 command_plugin 三模式在生产场景稳定性需增强
- 🔳 消息持久化、审计链路与异常补偿仍需完善

---

## 5) Notification SSE 与宿主-插件通信总线

**口径（见设计文档 §0–§1）**：**`host-event-hub.service.ts`** 统一 **`publish`** + **`HOST_EVENT_TOPICS`** + **多 topic**；**`publishToNotificationStream`**；**`ctx.publish`** 注入（§1.3）。**不**经 Hub：同步 **return**；**不**默认改 **`emitPluginActivity`** 链。

### 已实现

- ✅ `GET /api/notifications/stream`（常驻 SSE 通道；Hub 目标态下的 **SSE Sink**）
- ✅ 基础 scope 过滤（global/plugin/session）
- ✅ 心跳保活与断开清理
- ✅ scheduler 等事件经内存通知链路至 SSE（过渡：生产者直连 `notification-bus`）
- ✅ 前端已接入基础通知订阅（连接状态与最近事件显示）

### 未完成

- 🔳 **Host Event Hub** 独立模块与生产者迁入 Hub；SSE 仅作为 Sink 订阅 Hub
- 🔳 插件侧统一 **Ingress**（ctx 注入），去除对通知链路的直接依赖
- 🔳 ai-chat / plugin-chat / plugin activity 的统一 topic 化接入
- 🔳 前端通知列表与分 topic UI 渲染
- 🔳 Last-Event-ID 与补偿重放
- 🔳 多实例 Hub（Redis/NATS）与权限治理

---

## 6) 平台与工程化补齐项

- 🔳 MCP Gateway 路由未落地：
  - 🔳 `GET /api/mcp/catalog`
  - 🔳 `GET /api/mcp/tools/:toolId/schema`
  - 🔳 `POST /api/mcp/validate`
  - 🔳 `POST /api/mcp/invoke`
- 🔳 结构化日志查询接口未落地：`GET /api/logs/query`
- 🔳 自动化测试体系缺失（unit / integration 未建立）
- 🔳 可观测性基础设施不足（trace / metrics / audit 仍是最小态）

---

## 7) 优先级建议（next）

1. 完成微信桥联调验收与契约固化（错误码、取消登录、会话列表与本地账号索引一致性）。
2. 补齐 MCP Gateway 最小可用接口。
3. 建立最小测试基线（优先 scheduler + lease 的 service/route）。
4. 收敛 Chat SSE 事件规范并补验收样例。

