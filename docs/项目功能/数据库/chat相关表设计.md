# chat相关表设计

## 目标

- 说明 chat 第一阶段会用到的数据库表、字段与用途。
- 区分“消息内容存储”与“流程事件存储”。
- 支撑后续可审计、可回放、可扩展的 chat 架构。

## 数据库位置

- SQLite 文件：`var/data/host.db`
- 建表入口：`apps/host-api/src/core/db.ts`

## 表总览

| 表名 | 作用 | 第一阶段状态 |
|---|---|---|
| `plugin_chat_messages` | 存储会话消息（用户/assistant/系统） | 已有，已完成兼容扩展字段 |
| `chat_sessions` | 存储 **AI 编排** 会话状态机（normal/isolated） | 已新增并在代码读写 |
| `chat_events` | 存储流程事件（请求、模式切换、工具调用等） | 已新增并在代码写入 |
| `llm_config` | 存储全局 LLM 配置 | 已有 |
| `plugin_chat_sessions` | ~~独立存储「插件 Chat 侧边栏会话行」~~ | **不建表（已裁决）**，见下文 |

### 裁决：不新增 `plugin_chat_sessions`（截至 2026-05-02）

- **管理台插件 Chat 会话列表**由宿主导出：从 `plugin_chat_messages` 按 `(plugin_id, session_id)` **聚合**；无消息历史的 `session_id` 不会出现，除非宿主/插件在返回列表时显式补足（例如 `decorateSessions` 补默认会话）。
- **通用插件**：多数仅需要 `${plugin_id}:default` 一条链路，不因会话维度多一张表；插件卸载时也少一层会话表清理。
- **multi 会话插件（如 weixin-bridge）**：业务会话语义为「默认引导 + 账号」，账号侧以桥接层 `listAccounts` 等为准；`session_id` 采用约定命名即可，**无需**为列举会话再落库。

> 与 `chat_sessions` 区分：`chat_sessions` 服务 **`POST /api/ai/chat` 编排态**，**不是**「插件有哪些 Chat 会话」的清单表。

---

## 1) plugin_chat_messages（消息内容表）

### 作用

- 作为 chat 会话历史的主存储。
- 为前端展示与后续上下文拼接提供数据来源。

### 已有字段（当前项目）

- `id`
- `plugin_id`
- `session_id`
- `role`
- `content`
- `created_at`

### 扩展字段（第一阶段，已在代码落地）

- `source_type`：`runtime|plugin`
- `source_plugin_id`：来源插件 ID（可空）
- `llm_eligible`：是否并入后续 LLM 上下文（0/1）
- `context_summary`：结构化结果摘要（避免大 JSON 直接入上下文）

> 说明：当前通过“兼容迁移”方式在启动时尝试 `ALTER TABLE`，存在即跳过。

### 用途说明

- `ephemeral_no_context` 执行结果：本次执行不带历史，但回流消息 `llm_eligible=1`。
- `isolated_chat` 退出后的回流消息：`llm_eligible=1`，用于后续 runtime LLM 上下文。

---

## 2) chat_sessions（AI 编排会话状态表）

### 作用

- 管理 **`/api/ai/chat` 编排** 的会话状态机，支持 `normal` 与 `isolated` 切换。
- 记录当前是否处于插件隔离上下文。

### 字段（已落地）

- `plugin_id`
- `session_id`
- `mode`：`normal|isolated`
- `isolated_plugin_id`（可空）
- `updated_at`

> 当前主键为 `(plugin_id, session_id)`，用于区分同 sessionId 在不同插件下的状态。

### 用途说明

- 命中 `isolated_chat` 时写入 `mode=isolated`。
- 收到 `/close` 时恢复 `mode=normal`。
- 路由分流时优先读取该状态，决定消息去向。

---

## 3) chat_events（流程事件表）

### 作用

- 记录 chat 编排过程中的关键事件。
- 用于审计、排障、统计、后续 workflow/scheduler 触发。

### 字段（已落地）

- `id` (PK)
- `trace_id`
- `plugin_id`
- `session_id`
- `type`（事件类型）
- `source`：`host|llm|plugin|tool`
- `payload_json`
- `created_at`

### 事件类型建议

- `chat.request.received`
- `chat.mode.entered_isolated`
- `chat.mode.exited_isolated`
- `chat.command.executed`
- `chat.llm.called`
- `tool.call.started`
- `tool.call.finished`
- `chat.response.completed`
- （已落地）`chat.command.executed`
- （已落地）`chat.llm.called`

---

## 4) llm_config（LLM配置表）

### 作用

- 统一管理 provider/model/参数配置。
- 支撑 runtime 默认消息路径中的 LLM 调用。

### 当前状态

- 已落地并可通过 API 读写：
  - `GET /api/llm/config`
  - `PUT /api/llm/config`

---

## 数据流关系（简版）

1. 收到 chat 请求 -> 写 `chat_events(chat.request.received)`  
2. 用户消息写 `plugin_chat_messages`  
3. 执行分流（runtime/command/isolated）  
4. assistant 回流写 `plugin_chat_messages`  
5. 模式切换/工具调用写 `chat_events`  
6. 更新 `chat_sessions`（若状态变化）  

---

## 第一阶段最小 SQL（建议）

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  plugin_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  isolated_plugin_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, session_id)
);

CREATE TABLE IF NOT EXISTS chat_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT,
  plugin_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

> 备注：`plugin_chat_messages` 的字段扩展可采用“兼容迁移”方式进行，避免影响现有读写逻辑。

## 当前实现状态摘要

- 已完成：
  - 三张核心表创建与读写接入（`plugin_chat_messages`、`chat_sessions`、`chat_events`）。
  - 事件类型基础链路可写入（request/response/mode/command/llm）。
  - **刻意不建** `plugin_chat_sessions`：插件 Chat 会话列表由消息聚合 + 插件 `decorateSessions` 等协议补足（见上文裁决）。
- 待完成：
  - 事件消费与查询 API（目前仅写入）。
  - 更细粒度工具事件（`tool.call.started/finished`）端到端接入。
