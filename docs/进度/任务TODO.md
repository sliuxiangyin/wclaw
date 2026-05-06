# 任务 TODO（执行清单）

说明：按优先级推进。  
标记：`[ ] 待办` / `[~] 进行中` / `[x] 完成`

关联文档：
- 功能现状对照：`功能清单_status.md`

同步维护规则：
1. 先更新 `功能清单_status.md`（能力是否已完成）。
2. 再更新本清单（拆分到具体执行项、里程碑与优先级）。
3. 若两者冲突，以“代码现状 + 功能清单”作为最终口径，再回填本清单。

---

## P0（先做）

### 后端基础
- [x] 初始化 `apps/host-api`（Fastify + TypeScript）
- [x] 统一返回结构：`ok/data/error/traceId`
- [x] 统一错误码
- [x] 健康检查：`GET /health`
- [ ] 建立分层约束（route/controller/service/repository）并在新接口中执行

### 插件协议与配置
- [x] 接入插件清单校验（JSON Schema + 语义规则；口径见 `../项目功能/插件插件配置.md`）
- [x] 插件目录扫描与列表 API（`GET /api/plugins`、`GET /api/plugins/:pluginId`）
- [x] 实现插件配置 API：
  - [x] `GET /api/plugins/:pluginId/config`
  - [x] `PUT /api/plugins/:pluginId/config`
  - [x] `POST /api/plugins/:pluginId/config/validate`
- [x] 存储方案落地（优先 SQLite）

### 前端基础
- [x] 初始化 `apps/host-console`（React + Vite + shadcn/ui）
- [x] 插件 Grid 页面（搜索/过滤/进入 Chat）
- [x] 插件配置抽屉（schema-driven）
- [x] LLM custom 配置页面
- [ ] 建立前端分层约束（pages/features/lib-api）

---

## P1（核心）

### 通用 Chat（assistant-ui）
- [x] 集成 `assistant-ui`
- [x] `POST /api/plugins/:pluginId/chat`（先非流式）
- [x] 进入 Chat 恢复最近活跃会话（无会话自动建）
- [x] `capabilities.chat=false` 时走 `/command`

### 微信桥（登录 + 多账号 + 切会话）

> 宿主侧**不**实现 `weixin-bridge` 专用路由；一律走通用 `/api/plugins/:pluginId/...`。详见 `微信桥专项实施计划.md`。

- [x] 阶段 1：`plugins/weixin-bridge`（`plugin.json` + `runtime.mjs`）+ 宿主动态加载 + chat 后刷新会话列表
- [~] 阶段 2：对接真实微信桥（已内嵌 `openclaw-weixin`、扫码登录、`waitQr` 状态回调、异步登录推送至 chat；待生产级错误码与边界验收）
- [~] 阶段 3：runtime 稳定性（scheduler 已接管 `poll-inbox`；缓存 TTL、热更新、`safe_mode` 仍待补）
- [x] 前端：通用会话按钮切换（无微信专用组件；登录说明走 chat 文案）
- [x] Scheduler 需求与设计方案文档（`../项目功能/Scheduler调度器_需求与设计方案.md`）
- [x] 插件设计文档（`../项目功能/插件/插件架构设计.md`）

---

## P2（增强）

- [ ] Chat SSE 流式（`message.delta/tool.start/tool.end/message.done/error`）
- [~] Notification SSE 长连接通知（Phase 1 已落地；待补 topic 统一与前端通知面板）
- [~] 宿主-插件通信总线（HPC Bus）：写死规则见 `宿主插件通信总线/宿主-插件通信总线_设计文档.md` §0；待 Hub 模块落地、宿主生产者迁入 Hub；**不**含：扩改 `loadPluginRuntimeExtension` ctx、`emitPluginActivity` 并 Hub（除非单独 ADR）
- [ ] 结构化日志查询 `GET /api/logs/query`
- [ ] MCP Gateway：
  - [ ] `GET /api/mcp/catalog`
  - [ ] `GET /api/mcp/tools/:toolId/schema`
  - [ ] `POST /api/mcp/validate`
  - [ ] `POST /api/mcp/invoke`
- [x] 编排租约（内存版）：
  - [x] `POST /api/orchestration/lease/grant`
  - [x] `POST /api/orchestration/lease/revoke`

---

## 稳定性专项（runtime_plugin）

- [x] 去除裸 `while(true)` 轮询，统一接 scheduler（首批 runtime_plugin）
- [x] 并发上限 + 超时 + 退避（v1 默认策略）
- [ ] 缓存加 `TTL + maxSize`
- [ ] 热更新避免重复监听器注册
- [ ] OOM 风险降级到 `safe_mode`

### Scheduler 实施拆解（按文档落地）

- [x] Phase 1-1：新增 `scheduler-registry.service.ts`（任务注册/更新/注销）
- [x] Phase 1-2：新增 `scheduler-runner.service.ts`（触发执行、状态维护）
- [x] Phase 1-3：定义 `TaskDefinition/TaskRuntimeState/BackoffPolicy` 类型
- [x] Phase 1-4：接入任务调度参数：`intervalMs/jitterMs`
- [x] Phase 1-5：实现并发控制（全局 + 插件级 + 任务级）
- [x] Phase 1-6：实现任务超时控制（`timeoutMs`）
- [x] Phase 1-7：实现重试退避（`maxRetry + backoff`，支持 exponential）
- [x] Phase 1-8：接管至少一个 runtime_plugin 轮询任务（替代裸轮询）

- [x] Phase 2-1：新增 `scheduler-circuit-breaker.service.ts`
- [x] Phase 2-2：实现熔断状态机（closed/open/half-open）
- [~] Phase 2-3：连续失败触发 `safe_mode`，恢复窗口后半开探测（已完成熔断半开，`safe_mode` 响应策略待补）
- [x] Phase 2-4：新增 `orchestration-lease.service.ts`（内存版租约）
- [x] Phase 2-5：落地 `POST /api/orchestration/lease/grant`
- [x] Phase 2-6：落地 `POST /api/orchestration/lease/revoke`
- [x] Phase 2-7：新增 `scheduler-observer.service.ts`（统一记录事件）
- [x] Phase 2-8：统一事件类型：`start/success/fail/timeout/retry/open-circuit`
- [~] Phase 2-9：事件字段统一：`traceId/pluginId/taskId/sessionId?`（当前已覆盖 `traceId/pluginId/taskId`）

- [x] Phase 3-1：新增 Scheduler 健康查询接口（可选）
- [ ] Phase 3-2：补齐 service 层单测（registry/runner/circuit/lease）
- [ ] Phase 3-3：补齐 route 层集成测试（lease grant/revoke）
- [ ] Phase 3-4：压测并调优默认参数（并发、超时、退避、熔断阈值）
- [ ] Phase 3-5：完成 DoD 验收并回填 `功能清单_status.md`

### Scheduler 验收核对（逐项打勾）

- [x] 插件侧无裸 `while(true)` 轮询
- [x] Scheduler 已统一接管至少一个 runtime_plugin 任务流
- [x] 并发/超时/重试/退避策略可观测且可验证
- [ ] 熔断可触发与自动恢复，`safe_mode` 生效
- [x] `lease/grant`、`lease/revoke` 可调用且可回收
- [ ] 最小测试基线通过（service + route）

---

## 工程治理（防堆叠）

- [x] 新增 `设计模式与分层规范.md`
- [x] 新增架构规则检查脚本 `../../scripts/check-architecture.mjs` + `pnpm lint:arch`
- [x] 第二批架构规则（行数限制、service 解耦、route 禁止直连 sqlite）
- [x] 第三批架构规则（controller 行数、service 单向依赖、hooks 禁止 DOM 直操）
- [ ] PR 检查清单落地到开发流程（提测前必检）
- [~] 禁止插件特判分支（前端 Chat/欢迎语已改为 `kind + sessionProvider` 协议驱动；持续约束新增代码）

---

## 里程碑验收

- [x] M1：插件列表 + 配置 + LLM custom
- [x] M2：通用 Chat 可用
- [~] M3：微信桥登录/切号/切会话可用（扫码 + 异步状态推送 + 调度拉取已通；待联调验收与文档契约固化）
- [ ] M4：流式 + 日志 + 稳定性基线可用

---

## 本次启动开发记录（2026-05-01）

- [x] 已创建 monorepo 基础：`package.json`、`pnpm-workspace.yaml`
- [x] 已创建后端最小骨架：`apps/host-api`（含 `GET /health`）
- [x] 已创建前端最小骨架：`apps/host-console`（Vite + React）

## 本次推进记录（2026-05-02）

- [x] 已落地 Scheduler 主链路：`registry + runner + circuit-breaker + observer + lease`
- [x] 已新增编排接口：`/api/orchestration/lease/grant`、`/api/orchestration/lease/revoke`
- [x] 已新增调度状态接口：`/api/orchestration/scheduler/status`
- [x] 已打通插件运行时扩展：`executeCommand/getScheduledTasks/runScheduledTask`
- [x] 当前仓库插件以 `weixin-bridge`、`linux-do-fetch` 为主；历史测试插件记录已归档，不作为现行基线
- [x] `weixin-bridge` 已完成 openclaw-weixin 内嵌改造：去除 `while` 常驻轮询，改为 scheduler 单次拉取（`poll-inbox`）
- [x] `weixin-bridge` 已收敛默认会话行为：默认会话仅登录引导，账号会话处理收发与同步
- [x] 宿主 `orchestrateChat`：`sessionProvider.mode=multi` 且为默认会话时，非斜杠消息不走 LLM，回落 `handleChat`（协议驱动，无 `pluginId` 特判）
- [x] `weixin-bridge` 登录：同条 SSE 内 `waitQr`；扫码进度 **`plugin-activity`**；成功时 **`persist`** 由 `sendPluginChat` 写账号会话欢迎语
- [x] `openclaw-weixin`：`waitForWeixinLogin` 支持 `onStatus`（`scanned` / `qr_refreshed` / `confirmed`）；`standalone/runtime.waitQr` 透传
- [x] 前端：插件 Grid 状态/模式中文；Chat 页多会话 runtime 引导与欢迎建议（协议驱动，满足 `lint:arch`）

## 本次推进记录（2026-05-03）

- [x] 文档新增：`notification_sse_长连接通知通道设计.md`
- [x] 文档新增：`宿主-插件通信总线_功能文档.md`、`宿主-插件通信总线_设计文档.md`、`宿主-插件通信总线_改造文档.md`
- [x] 后端落地：`/api/notifications/stream` + `notification-bus` + scheduler 事件推送
- [x] 前端落地：基础 SSE 订阅与连接状态显示
- [x] ai-chat 落地：会话级串行队列（`pluginId+sessionId`）

