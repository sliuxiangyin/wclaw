# 前端历史消息 + 插件活动 — TODO（已定结论与计划）

> **已定结论（评审）**  
> 1. **同意**：历史 API 使用 `GET /api/plugins/:pluginId/sessions/:sessionId/messages`（与现有插件 API 前缀一致）。  
> 2. **同意**：首版 **进页拉最近 N 条**（全量窗口），**不做**游标翻页。  
> 3. **`plugin-activity` 要入库**；**永不进入 LLM 上下文**；需 **类型/表级区分**，与 `user`/`assistant` 正文可机器区分。  
> 4. **UI**：插件活动 **挂在当前轮次 assistant 消息下方**（同一条 assistant 气泡内的子区域 / 子列表），**需要回显**；**不再**使用整条会话顶部的「插件活动」条作为最终形态（可过渡保留或首版即迁走）。

---

## 建议：数据模型（满足 3：入库 + 不入 LLM）

**推荐 A：独立表 `plugin_chat_activity`（首选）**

| 字段 | 说明 |
|------|------|
| `id` | 自增 |
| `plugin_id`, `session_id` | 与会话一致 |
| `trace_id` | 与本轮 `POST /api/ai/chat` 的 `traceId`（如 `request.id`）一致，用于 **把多条 activity 与同一轮 user/assistant 绑定** |
| `seq` | 同 trace 内递增，保证顺序 |
| `phase`, `payload_json` | 与 SSE `plugin-activity` 对齐 |
| `created_at` | 写入时间 |

- **写入点**：与当前写 SSE `plugin-activity` **同一路径**（路由层或编排注入的回调）调用 **`appendPluginActivity`（repository）**，保证 **流上看见 ≈ 库里有一条**（失败策略：先落库再推 SSE 或事务顺序需定一条）。  
- **LLM**：`buildWithContextWindow` / 任何组装 `messages` 给模型的逻辑 **只查 `plugin_chat_messages`**，**不读** `plugin_chat_activity`。  
- **列表 API**：`GET .../messages` 可返回 `{ messages: [...], activities: [...] }` 或后端 **合并为 timeline**（推荐后端合并，前端简单）。

**备选 B：同表 `plugin_chat_messages` 增加 `row_kind`**

- `row_kind`: `chat` | `plugin_activity`；`plugin_activity` 行 `role` 可固定 `assistant` 或单独 `system` + **LLM 查询一律 `WHERE row_kind='chat'`**。  
- 缺点：与现有语义混杂，迁移与索引要更小心。

**结论**：优先 **表 A**，语义清晰、LLM 隔离零成本。

---

## 建议：UI（满足 4：assistant 下 + 回显）

- **流式中**：`text-delta` 仍驱动主 assistant 文本；每条 `plugin-activity` **同时落库**后，在 **同一条正在生成的 assistant 消息** 下追加子项（React state：`currentTurnActivities[]` 与当前 run 绑定，`onPluginActivity` push）。  
- **历史加载**：根据 `trace_id`（或后端返回的 **已嵌套结构**）把 activity 列表 **挂到对应 assistant 节点下**渲染；**不要**再单独用顶部全局列表作为唯一数据源。  
- **assistant-ui**：若标准 `UIMessage` 不便表达「子块」，二选一：  
  - **自定义 assistant 消息组件**：读 `message.metadata.pluginActivities`（由 hydrate 时写入）；或  
  - **扩展 `parts` / data 部件**（需对齐 `ai` / assistant-ui 版本能力）。  
- **首版可接受**：先实现 **自定义 `Ai05AssistantMessage`** 内渲染 `metadata` + 子列表，不强行塞进未支持的 chunk 类型。

---

## 实现阶段（建议顺序）

### 阶段 1 — 后端持久化 activity

- [x] 新增表 `plugin_chat_activity` + `CREATE TABLE IF NOT EXISTS`（`db.ts`）。  
- [x] `plugin-chat-activity.repository.ts`：`appendPluginActivity`、`listPluginActivitiesBySession` / `listPluginActivitiesTail`。  
- [x] `ai-chat.routes.ts`：`onPluginActivity` **先落库**（`persistPluginActivityForAiChat`）再写 SSE。  
- [x] **`trace_id`** 与 `POST /api/ai/chat` 的 `request.id` 一致；`plugin_chat_messages` 暂无 `trace_id` 时由 timeline + `traceId` 在 UI 层挂载活动。

### 阶段 2 — 历史只读 API（你已同意 1、2）

- [x] `GET /api/plugins/:pluginId/sessions/:sessionId/messages?limit=N`  
  - 返回：`{ pluginId, sessionId, limit, timeline: [...] }`；`timeline` 为 **合并排序** 后的数组，元素 `kind` 为 `message` | `plugin_activity`（camelCase 字段，与 SSE 语义对齐）。  
- [x] **service + route**（本项目无独立 controllers 层），`lint:arch` 通过。  
- [x] 文档：`docs/项目功能/宿主/宿主功能.md` 接口列表已补一行；本段为响应形状说明。

### 阶段 3 — 前端历史 + 布局调整（你已同意 2、4）

- [x] `getPluginChatHistoryTimeline` → `timelineToUiMessages`（合并 timeline）。  
- [x] `sessionId` 变化：`useChatRuntime({ messages })` 注水，`metadata.pluginActivities` 挂在对应 assistant。  
- [x] 移除顶部全局「插件活动」条；流式活动在 **assistant 气泡内** 展示，结束后归档到当前条（避免清空 feed 后丢失）。  
- [x] 流式：`onPluginActivity` 经 Context 汇入最后一条 assistant；与后端落库顺序一致（刷新可走 GET timeline）。

### 阶段 4 — LLM 与清理

- [ ] 全文检索 `buildWithContextWindow` / 任意 LLM 入口：**不得**拼接 `plugin_chat_activity`。  
- [ ] 双写 user 是否修：仍建议 **单独 PR**（不阻塞 1–3）。

---

## P0 清单（与上文阶段对应，可勾选）

- [x] 表 + repository + SSE 写库  
- [x] GET messages（`timeline` 后端合并）  
- [x] 前端拉历史 + assistant 下展示 + 去顶部条  
- [x] LLM 路径确认无 activity 泄漏（宿主侧仅 timeline/history/API 读取 activity，`ai-chat`/`plugin-chat` 组装模型上下文未读 `plugin_chat_activity`）  

---

## 仍待你后续拍板（非阻塞）

- ~~**先落库再 SSE** 还是 **先 SSE 再落库**~~ → **已定：先落库再 SSE**（`plugin-activity` chunk）。  
- ~~**timeline** 由后端合并还是前端合并~~ → **已定：后端合并**（本 `GET .../messages`）。

---

*上次「审核请拍板」三问中第 3 条已由你改为「activity 入库」；本文档已同步。*
