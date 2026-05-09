# AGENTS.md — wclaw-weixing-v3

> 本文件面向 AI 编码助手。阅读者应被视作对该项目一无所知。以下所有信息均来自对项目实际文件的分析，不做假设性推断。

---

## 1. 项目概览

`wclaw-weixing-v3` 是一个以"宿主中心、插件解耦、可控编排"为设计核心的 MCP Host Gateway 项目。宿主（Host）负责插件生命周期管理、会话路由、MCP 网关代理、策略与权限控制；插件通过声明式清单（`plugin.json`）向宿主注册能力，禁止直连 MCP 或访问宿主内部实现。

当前阶段已实现：
- 宿主后端 API（`host-api`）：插件发现、配置管理、插件 Chat / Command、AI Chat 编排、LLM 配置
- **Scheduler v1**：启动时 `bootstrapScheduler`，按插件 `getScheduledTasks` 周期执行 `runScheduledTask`；`GET /api/orchestration/scheduler/status`
- **编排租约（内存版）**：`POST /api/orchestration/lease/grant`、`POST /api/orchestration/lease/revoke`（已注册路由）
- 插件运行时扩展：入口 **`export default class`**；启动时 **`createPluginRuntimeProvider`** 预加载 **`Map<pluginId, instance>`**，构造注入 **`{ pluginId, publish }`**（`publish` 为 Hub 窄接口）；Chat / Scheduler / AI 编排经 **`PluginRuntimePort`** 取实例并调 **`executeTurn` / `getScheduledTasks` / `runScheduledTask`** 等（类型见 **`@wclaw/plugin-sdk`**）；**`services` 禁止值导入 `providers`**
- 宿主前端管理台（`host-console`）：插件 Grid（状态/模式）、配置表单、多会话 Chat、LLM 设置；Chat 与欢迎文案按 **`kind` + `sessionProvider`** 协议驱动，**禁止** `pluginId` 特判（`lint:arch`）
- 现有插件（`plugins/`）：`weixin-bridge`（`runtime_extension`）与 `linux-do-fetch`（`command_plugin`）。其中 `weixin-bridge`：`runtime.mjs` 为 `export default class`；内嵌 `openclaw-weixin`（需在其子目录 `npm run build` 生成 `dist`）；真实扫码登录；`/login` 在同一次 SSE 内 `await waitQr`，进度经 **`emitAssistantDelta`** 写入助手正文流；跨会话欢迎语经 **`handleChat` 返回 `persist`** 由宿主统一落库；收件拉取由调度任务 **`poll-inbox`** 单次执行；默认会话仅登录引导，账号会话走正常收发

项目仍处于早期活跃开发阶段，部分蓝图中的能力（如 **MCP Gateway**、**Chat SSE**、统一可观测性、调度 **`safe_mode` 全链路**）尚未完整落地。

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 包管理器 | pnpm 10.x（Workspace Monorepo） |
| 运行时 | Node.js 20 LTS |
| 语言 | TypeScript 5.x |
| 后端框架 | Fastify 5.x + `@fastify/cors` |
| 前端框架 | React 19 + Vite 5 + `@vitejs/plugin-react` |
| 聊天 UI | `@assistant-ui/react` |
| 数据库 | `node:sqlite`（`DatabaseSync`）；路径为 **进程 cwd** 下 `var/data/host.db`（从仓库根执行 `pnpm dev:api` 时 cwd 为 `apps/host-api`，故库文件在 `apps/host-api/var/data/host.db`） |
| 开发热重载 | `tsx watch`（后端）、`vite`（前端） |
| 构建 | `tsc`（后端编译到 `dist/`）、`vite build`（前端） |

前端 UI 目前使用原生 `<button>` 和内联样式，未深度引入 shadcn/ui 或 Tailwind（蓝图中有规划，但当前代码中未实际使用）。

---

## 3. 仓库结构

```
wclaw-weixing-v3/
├── apps/
│   ├── host-api/            # 后端 API（Fastify + SQLite）
│   │   ├── src/
│   │   │   ├── server.ts    # 入口：启动 HTTP 服务（默认 8787）
│   │   │   ├── app.ts       # Fastify 实例创建、CORS、错误处理、路由注册
│   │   │   ├── core/        # db.ts、error-codes.ts、response.ts、app-error.ts
│   │   │   ├── routes/      # 路由注册（薄层，只负责映射 URL）
│   │   │   ├── controllers/ # 参数提取与响应包装
│   │   │   ├── providers/   # Host Event Hub、NotificationProvider 等（`app.ts` 组合根组装） 适合需要后台运行的或者初始化运行的
│   │   │   ├── services/    # 业务逻辑（禁止依赖 Fastify、routes、controllers）
│   │   │   └── repositories/# 唯一允许直接操作 SQLite 的层
│   │   ├── package.json     # @wclaw/host-api
│   │   └── tsconfig.json    # module: NodeNext, target: ES2022
│   └── host-console/        # 前端管理台（React + Vite）
│       ├── src/
│       │   ├── main.tsx     # 入口
│       │   ├── App.tsx      # 根组件（tab 导航）
│       │   ├── lib/api/     # 统一 API 客户端（禁止在 pages 中直接 fetch）
│       │   ├── features/    # 按领域划分的 hooks + components
│       │   └── pages/       # 页面壳（只做编排，逻辑下沉到 features/hooks）
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json     # @wclaw/host-console
│       └── tsconfig.json    # module: ESNext, moduleResolution: Bundler
├── packages/
│   └── plugin-sdk/          # @wclaw/plugin-sdk：插件与宿主的 TS 类型契约（无宿主实现）
├── plugins/                 # 插件仓（被 host-api 动态扫描加载）
│   └── weixin-bridge/
│       ├── plugin.json
│       ├── runtime.mjs          # default class 入口
│       ├── bridge-adapter.mjs   # 对接 openclaw-weixin dist
│       └── openclaw-weixin/     # 子项目：构建后 dist 供 adapter 引用
├── scripts/
│   └── check-architecture.mjs  # 架构规则自动检查脚本
├── docs/                    # 多份 Markdown（含 `docs/进度/` 等）
├── package.json             # 根脚本：dev:api / dev:web / lint:arch
├── pnpm-workspace.yaml      # apps/*, packages/*, plugins/*
└── apps/host-api/var/data/host.db   # SQLite（默认 dev 下相对 host-api cwd 生成）
```

---

## 4. 构建与运行命令

在仓库根目录执行：

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev:api    # 启动 host-api（tsx watch），默认 http://localhost:8787
pnpm dev:web    # 启动 host-console（vite），默认 http://localhost:5173

# 架构规则检查
pnpm lint:arch  # 运行 scripts/check-architecture.mjs
```

在各自应用目录内也可直接执行：

```bash
# apps/host-api
pnpm dev        # tsx watch src/server.ts
pnpm build      # tsc -p tsconfig.json

# apps/host-console
pnpm dev        # vite
pnpm build      # vite build
```

**环境变量**：
- `PORT` / `HOST`：后端监听地址（默认 `8787`、`0.0.0.0`）
- `CORS_ORIGIN`：CORS 来源，支持 `true` / `false` / 逗号分隔列表
- `VITE_API_BASE_URL`：前端调用后端的基地址（默认 `http://localhost:8787`）

---

## 5. 代码风格与架构规则

### 5.1 分层规范（硬性规则）

后端依赖方向（严格单向）：
```
routes → controllers → services → repositories
```

- **routes**：只负责路由映射，禁止包含 SQL、业务逻辑、直接创建数据库连接。
- **controllers**：只做参数提取和响应包装，禁止演变为业务大文件（行数 ≤ 260）。
- **services**：核心业务逻辑，禁止导入 `fastify`、禁止导入 `../routes/` 或 `../controllers/`。
- **repositories**：唯一允许直接操作 `node:sqlite` 的层。

前端依赖方向：
- **pages**：页面壳，禁止直接 `fetch`，禁止承载复杂状态（行数 ≤ 320）。
- **features/*/hooks**：状态与业务逻辑，禁止直接操作 DOM（`document.*`、`window.*`）。
- **lib/api**：统一 API 客户端。

### 5.2 插件解耦硬规则

- 宿主代码中**禁止**出现插件特判分支，例如 `pluginId === 'weixin-bridge'`。
- 插件**禁止**直连 MCP Server，所有 MCP 调用必须通过宿主网关代理。
- 插件**禁止** import 宿主内部目录。

### 5.2.1 宿主-插件通信总线（HPC / Host Event Hub）写死规则

以下与 `docs/项目功能/宿主插件通信总线/宿主-插件通信总线_设计文档.md` **§0、§1** 一致：

- **宿主经 `PluginRuntimePort.get` 调用插件 `default` 类实例方法**：**返回值 / 异常**不经 Hub；**不调** Hub 替代同步返回。
- **`ctx.publish`（唯一允许的 ctx 扩展）**：仅可增加可选 **`publish?`**，由宿主注入闭包指向 **`HostEventHub` 实例的 `publish`**（实现位于 `providers/host-event-hub-provider/`）；**禁止**在同一段 ctx 上再叠其它 HPC API（详见设计文档 §0.1.1、§1.3）。
- **助手流式正文**（`emitAssistantDelta` → `text-delta`）与 **`ctx.publish`/Hub** 职责分离；**不要求**并进常驻 Notification SSE。
- **Hub**：统一 **`publish`**；**`HOST_EVENT_TOPICS`**（如 Notification、Chat）；**多 topic** 一次调用由 Hub 逐 topic 分发；**`publishToNotificationStream`** 固定 Notification topic。
- **Hub 与 Provider**：**`HostEventHub`**（class，位于 `providers/host-event-hub-provider/`）提供 `registerProvider` / `publish`；**`new HostEventHub(notificationProvider)`** 内部自动挂载 Notification Bridge；**`NotificationProvider`** 在 `providers/notification-provider/`（见 **`docs/项目功能/宿主插件通信总线/host-event-hub_providers_设计.md`**）。
- 插件**禁止** import 宿主 Hub、`NotificationProvider` 实现或 Notification 路由。

### 5.2.2 host-api：类与显式传参（团队约定）

- **尽量**在 `host-api` 宿主侧用 **class** 表达有状态或可替换单元；依赖通过 **构造函数、工厂入参或 `createApp` 组装** 显式下传，调用方 **持实例再调方法**，**避免**新增仅 **`export` 模块级单例 + 全库静态 `import` 隐式依赖** 的链路。
- 组合根：**`apps/host-api/src/app.ts`（`createApp`）** 负责 `new`、传参与 `register*(app, deps)`；详情见 **`docs/host-api_Class与显式依赖注入_需求.md` §6**。

### 5.3 命名与格式约定

- 使用 ES Modules（`"type": "module"`），文件后缀在导入时显式写出 `.js`（后端编译后兼容需要）。
- 后端源码目录使用 kebab-case 文件名，例如 `plugin-catalog.service.ts`、`llm-config.routes.ts`。
- 类型定义优先使用 `type` 而非 `interface`（观察到的代码风格）。
- 统一响应包装格式：
  ```ts
  { ok: boolean, data: T | null, error: { code, message } | null, traceId: string | null }
  ```
- 错误码定义在 `apps/host-api/src/core/error-codes.ts`，使用 `AppError` 抛出可预期异常。

### 5.4 自动检查

`scripts/check-architecture.mjs` 通过正则扫描源码，强制执行多条规则（含 **services 与 providers 不得相互 import**）。新增代码应确保 `pnpm lint:arch` 通过。建议将其加入 CI 流水线，失败时阻止合并。

---

## 6. 插件系统

### 6.1 插件发现与加载

1. `host-api` 启动时扫描 `plugins/` 下的子目录。
2. 读取每个目录中的 `plugin.json`，按 `docs/项目功能/插件插件配置.md` 与宿主校验逻辑进行 JSON Schema + 语义校验。
3. 启动时在组合根对 **`plugin.json` → `entry`** 执行 **`import()` + `new DefaultClass({ pluginId, publish })`**（失败插件跳过并打日志）；**`runtime_extension`** 入口须 **`export default class`**，宿主对实例调用 **`executeTurn` / `decorateSessions` / `getScheduledTasks` / `runScheduledTask` / `clearSession` / `executeCompleted`** 等可选方法（与 **`@wclaw/plugin-sdk` 的 `PluginRuntimeExtension`** 对齐）。
4. 实例方法语义（与旧命名导出等价）：
   - **`executeTurn` 的 `PluginTurnHandleResult`**（`text` / **`continue` / `persist`**）：**与 `kind` 无关、全插件通用**，宿主与 `toTurnResult` 默认值一致；细则见 **`docs/项目功能/插件/插件.md`**「executeTurn 返回协议」。
   - **`handleChat(ctx)`** —— 处理聊天消息；可返回 **`string` 或 `{ reply, persist? }`**；流式进度用 **`emitAssistantDelta`**；**`ctx` 不含 `pluginId` / `publish`**
   - **`decorateSessions()`** —— 丰富会话列表展示（无参）
   - **`executeCommand(ctx)`** —— 命令执行（若 `capabilities.command`）；**`ctx` 不含 `pluginId`**
   - **`getScheduledTasks()`** —— 返回调度任务定义
   - **`runScheduledTask(taskId, ctx)`** —— 单次调度任务执行；**`ctx` 仅含 `config`**

**类型契约**：以 **`@wclaw/plugin-sdk`** 为准；插件 **禁止** import 宿主内部。**`plugins/weixin-bridge/openclaw-weixin/`** 为内嵌子项目，**勿为对齐宿主契约而修改该子树**；仅维护 **`weixin-bridge` 外层 `runtime`** 即可。

### 6.2 插件清单关键字段

- `id`：kebab-case，全局唯一
- `kind`：`runtime_extension` 或 `command_plugin`
- `entry`：相对插件目录的可执行文件路径
- `capabilities`：声明 chat、llm、command、mcpAccess、crossPluginInvoke、orchestration 等能力
- `permissions`：deny-by-default 权限列表
- `sessionProvider.mode`：`single` 或 `multi`
- `configSchema` / `defaultConfig`：驱动前端自动生成配置表单

### 6.3 现有插件

| 插件 | 类型 | 状态 |
|------|------|------|
| `weixin-bridge` | `runtime_extension` | 可用：`export default class` 入口、`runtime.mjs`；内嵌 openclaw-weixin、扫码登录、多账号会话、Scheduler `poll-inbox`；状态目录见子项目 `resolveStateDir()`（**不**改 `openclaw-weixin/` 以满足宿主契约） |
| `linux-do-fetch` | `command_plugin` | 可用：入口 `dist/runtime.mjs`；通过宿主编排调用 Playwright 能力抓取 `linux.do` 页面快照并回传摘要文本 |

---

## 7. 测试说明

**当前状态：测试基础设施尚未接入。**

- 根 `package.json` 及各应用 `package.json` 中均**无** `test` 脚本。
- `DIRECTORY_STRUCTURE.md` 中规划了 `apps/host-api/tests/integration/` 和 `apps/host-api/tests/unit/`，但目录尚未创建。
- 在添加测试框架（如 Vitest / Node:test）时，应遵循现有分层：
  - services 层测试可独立进行（不依赖 Fastify 实例）
  - repositories 层测试需准备 SQLite 内存数据库或临时文件
  - routes / controllers 测试可使用 Fastify 的 `inject()`

---

## 8. 安全与权限

- 权限模型为 **deny-by-default**：未在 `plugin.json` 的 `permissions` 中声明的权限即视为无权限。
- 高风险权限（`exec.command`、`network.write`、`context.global.write`）默认需要显式策略确认。
- 运行时加载器对 `entry` 路径做了 `..` 过滤，防止路径遍历逃逸出插件目录。
- CORS 默认开启（`origin: true`），生产环境应通过 `CORS_ORIGIN` 限制来源。
- 数据库路径相对 **host-api 进程 cwd**（见 §2 技术栈表）；勿将含业务或敏感数据的 `host.db` 提交到版本控制。

---

## 9. 开发流程约定

1. **Docs-first**：新需求应先更新 `docs/` 中的相关文档，再写代码。
2. **API-first**：任何 API 变更必须先同步接口契约文档（如 `weixin_bridge_api_contract_微信桥接口契约.md`）。
3. **每周更新 TODO**：`docs/进度/任务TODO.md` 与进度类清单应至少每周核对一次。
4. **PR Checklist**（来自 `docs/设计模式与分层规范.md`）：
   - 模块职责是否清晰？
   - 接口契约文档是否已更新？
   - routes/controllers 是否保持薄层？
   - SQLite 是否只在 repositories 中？
   - 前端逻辑是否放在 feature hooks 而非 pages？
   - 是否无插件特判分支？
   - 错误响应是否遵循 `ok/data/error/traceId` 格式？

---

## 10. 文档索引

项目 `docs/` 目录包含以下关键文档，修改相关模块时应同步查阅或更新：

| 文档 | 内容 |
|------|------|
| `docs/项目蓝图.md` | 整体架构、技术栈、DoD、MCP Gateway 设计 |
| `docs/项目功能/插件插件配置.md` | 插件 `plugin.json` 字段、配置项与运行时映射说明 |
| `packages/plugin-sdk/src/runtime-contract.ts` | 插件 runtime 关键类型契约（`PluginRuntimeExtension` 等） |
| `scripts/check-architecture.mjs` | 可执行的架构硬性规则与 `lint:arch` 说明 |
| `docs/前端方案.md` | 前端页面设计、组件选型、API 列表 |
| `docs/weixin_bridge_api_contract_微信桥接口契约.md` | 微信桥与通用插件 API 映射；`userText` / `metadata.wxReplyTo` / 通知预览口径 |
| `docs/进度/外部进线-ingest检查清单.md` | `ingestExternalUserTurn`、`reflowChatToChannel`、前端 `chat.session.updated` 联动验收 |
| `DIRECTORY_STRUCTURE.md` / `目录架构.md` | 前后端目录结构与初始化顺序 |
| `设计模式与分层规范.md` | 设计模式、反模式、PR Checklist |
| `docs/host-api_Class与显式依赖注入_需求.md` | host-api：**class + 显式传参** 团队约定（§6）、与 Hub/Notification 装配相关需求 |
| `packages/plugin-sdk/README.md` | **`@wclaw/plugin-sdk`**：插件与宿主 runtime 类型契约；**勿**为对齐契约修改 `openclaw-weixin` 子树 |
| `docs/进度/任务TODO.md`、`docs/进度/功能清单_status.md` | 可执行进度与能力对照 |
| `docs/微信桥专项实施计划.md` | 微信桥分阶段任务与推进清单 |
| `DOCS_INDEX.md` / `文档导航.md` | 文档总索引与维护规则 |

---

## 11. 已知缺口与注意事项

- **MCP Gateway**：蓝图有定义，当前 `app.ts` **未**注册 MCP 目录/调用路由。
- **Chat SSE**：流式消息与工具事件尚未接入。
- `POST /api/plugins/:id/config/validate` 当前为桩实现，始终返回 `valid: true`。
- **调度治理**：熔断/重试等已有基础实现；**`safe_mode` 降级策略**、压测调参、service/route 单测仍待补齐。
- 无可观测性基础设施（指标/集中日志），仅有 Fastify 内置日志。
- `packages/` 已含 **`@wclaw/plugin-sdk`**（插件 runtime 类型契约）；`protocol-core` 等仍待创建。
- 修改 `openclaw-weixin` 源码后需在 `plugins/weixin-bridge/openclaw-weixin/` 内执行构建，否则 `bridge-adapter` 仍读旧 `dist`。

---

*本文件基于项目当前实际内容生成。若项目结构或约定发生变化，应同步更新本文件。*
