# 宿主 MCP Gateway：需求与设计建议

## 1. 背景与目标

项目定位为 **MCP Host Gateway**：插件 **不得**直连 MCP Server，必须由宿主统一管理 MCP 接入、探测、策略与代调用（见 `docs/项目蓝图.md`、`docs/项目功能/宿主/宿主功能.md`）。

当前状态：`GET/POST /api/mcp/catalog|tools|validate|invoke` 等仍为规划项，宿主 **尚未**落地 MCP Gateway 运行时。

本稿目标：

1. 明确 **可配置的 `mcpServers` 接入**（多实例、启停、健康与工具发现）。
2. 支持至少两种传输：**stdio**、**http**（可扩展）。
3. 管理台 UI 对齐参考图：**已安装 MCP 列表** + **点击进入 JSON 编辑**（高级配置）；列表上展示在线状态、工具数量、启用开关等。

---

## 2. 功能需求（产品）

### 2.1 配置与生命周期

| 编号 | 需求 | 优先级 | 备注 |
|------|------|--------|------|
| F-01 | 宿主内可注册 **多条** MCP Server 配置（增删改查） | P0 | 每条有稳定 `id`（kebab-case 或 UUID），供 catalog 聚合 |
| F-02 | 每条配置可选择传输类型 **stdio** 或 **http** | P0 | 语义见第 4 节 |
| F-03 | 每条配置可被 **启用/禁用**（开关） | P0 | 禁用后不参与 handshake、不向 catalog 暴露工具 |
| F-04 | 启动或手动「刷新」时，对已启用条目做 **能力与工具发现**（`tools/list` 等 MCP 语义） | P0 | 失败时条目显示错误态，不误杀宿主主进程 |
| F-05 | 列表 UI 展示 **连接/健康状态**（如在线绿点）、**可用工具数量** | P1 | 与参考图一致；状态可异步轮询或由刷新接口更新 |
| F-06 | 支持展开查看 **工具名称列表**（可选描述） | P1 | 供运维确认接入是否成功 |
| F-07 | 点击「编辑」进入 **JSON 编辑页**：编辑完整单条 Server 配置，校验通过后保存 | P0 | 与「表单向导」可分阶段：首版 JSON 即可 |
| F-08 | 底部入口 **新建 MCP Server**（同样进入 JSON 模板或空白 Schema） | P0 | |

### 2.2 认证与会话（分阶段）

| 编号 | 需求 | 优先级 | 备注 |
|------|------|--------|------|
| F-09 | 对需 OAuth / 令牌类的 HTTP MCP，宿主侧保留 **会话或令牌存储**（加密落库可选） | P2 | 参考图中有「Logout」类操作；首版可先 document-only 或只做 `headers`/env |
| F-10 | Console 上对某 Server 暴露 **登录/登出** 链路由 Gateway 跳转或 device code | P2 | 与具体 MCP 生态耦合，不建议首版_blocking |

---

## 3. 非功能与安全约束（必须与蓝图一致）

以下内容与现有文档 **硬对齐**，实现时不得削弱：

1. **插件**：禁止创建 MCP Client、禁止持久化 MCP 凭据（蓝图 2.1）。
2. **调用审计**：任意经宿主的 MCP 调用需关联 `traceId`，并关联业务维度（建议 `sessionId`、`pluginId` 若可得）。
3. **策略**：`plugin.json` 中 `capabilities.mcpAccess` 与 `mcp.allowedTools` / `deniedTools` 参与 **工具可见性与调用准许**（与 `GET /api/mcp/catalog`、`POST /api/mcp/invoke` 设计一致）。
4. **宿主实现**：不出现 `pluginId === 'xxx'` 特判；MCP Server 条目为 **宿主全局资源**，插件仅通过匿名网关 API + 策略消费。
5. **敏感配置**：stdio 的 `env`、http 的 `headers`、令牌等 **仅存宿主侧**，Console 加载时可做 **掩码返回**（只写不脱敏需产品确认）。
6. **资源隔离**：stdio 子进程须有超时、并行上限、熔断，避免拖累 host-api（与蓝图「可熔断」一致）。

---

## 4. 传输与配置模型建议

### 4.1 通用字段（所有传输）

建议在持久化文档中统一外层结构（与 UI JSON 编辑器一致），示例形状（非最终 Schema）：

```json
{
  "id": "n8n-manager",
  "displayName": "n8n-manager",
  "enabled": true,
  "transport": "stdio",
  "stdio": {
    "command": "npx",
    "args": ["-y", "@some/mcp-server"],
    "cwd": null,
    "env": {}
  },
  "http": null,
  "notes": "可选运维备注"
}
```

或 `transport: "http"` 时使用 `http` 块、`stdio` 为空。

约定：

- **`id`**：宿主内唯一。
- **`enabled`**：与 UI 开关一致。
- **互斥**：`transport` 与对应块一致；服务端校验一方非空一方空。

### 4.2 stdio

| 字段 | 说明 |
|------|------|
| `command` | 可执行文件名（宿主进程 PATH 内或绝对路径，需防注入与路径枚举） |
| `args` | 参数数组 |
| `cwd` | 可选工作目录（建议限制在允许目录或可配置策略） |
| `env` | 附加环境变量（密钥主要放这里时需脱敏策略） |

实现提示：每条启用的 stdio Server 对应 **长驻子进程** 或 **请求级短连接**；MCP 常见为会话型 JSON-RPC，首版可采用 **单 Server 单子进程 + 串行或多路复用** 的简单模型，复杂度上升后再做连接池。

### 4.3 http

| 字段 | 说明 |
|------|------|
| `url` | MCP HTTP 入口（SSE / streamable HTTP 等以所选 Node MCP Client 为准） |
| `headers` | 可选请求头（Bearer、API Key 等） |

实现提示：与 `@modelcontextprotocol/sdk`（或宿主选定栈）对齐 **官方 Remote MCP** 语义；版本升级时在文档中单开「传输兼容矩阵」。

### 4.4 工具标识（catalog）

建议聚合 catalog 中单工具的稳定键为：**`toolId`** = `` `${serverId}/${mcpToolName}` ``（或等价 URL-safe 拼接），与现有规划 `GET /api/mcp/tools/:toolId/schema` 对齐，`invoke` 时同样传入该键以便路由到对应 Server。

---

## 5. 后端设计建议（host-api）

### 5.1 分层 placement

遵循仓库分层：`routes → controllers → services → repositories`。

- **`repositories`**：仅存 **配置文档**（整行 JSON 或规范化列 + JSON），不做 MCP 握手。
- **`services/mcp-gateway`（或等价模块）**：配置校验、握手、缓存 tools 列表、invoke 编排、与策略模块交互。
- **`providers`**：可放置 **进程/连接持有者**（stdio 子进程、mcp session），由 `app.ts` 组合根组装并注入 service；避免 service **值导入** `providers` 违反 `lint:arch`（仅用构造函数注入或工厂）。

### 5.2 建议 API（配置面 + 与蓝图合一）

在既有蓝图接口之外，增加 **管理配置**（仅 Console 或受信管理员使用；若暂无鉴权需内网-only 或后续补 auth）：

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/mcp/servers` | 列表（可脱敏）+ 最近一次探测状态快照 |
| GET | `/api/mcp/servers/:id` | 单条全文（按需脱敏） |
| PUT | `/api/mcp/servers/:id` | 创建或替换（含 JSON Schema 校验） |
| DELETE | `/api/mcp/servers/:id` | 删除并释放连接 |
| POST | `/api/mcp/servers/:id/reconnect` 或 `/api/mcp/discover` | 触发单次 handshake / 刷新 tools |

蓝图侧（插件消费）保持不变方向：

| GET | `/api/mcp/catalog` |
| GET | `/api/mcp/tools/:toolId/schema` |
| POST | `/api/mcp/validate` |
| POST | `/api/mcp/invoke` |

`catalog` 返回结构中建议包含：`serverId`、`serverLabel`、`transport`、`tools[]`、`enabled`，便于前端与插件一致理解。

### 5.3 错误与熔断

- 单 Server handshake 失败：`status=degraded`，列表展示原因摘要，不影响其他 Server。
- 连续 invoke 超时/报错：条目级断路（可选），与编排 `safe_mode` 策略衔接留扩展点。

---

## 6. 前端设计建议（host-console）

### 6.1 页面结构（对齐参考图）

1. **MCP Servers 列表页**
   - 行：图标/首字母、状态点、名称、可选「Logout/登录」（阶段二）、**N tools enabled**、展开箭头。
   - 操作：编辑（铅笔）、删除（垃圾桶）、**启用开关**。
   - 底部：**+ New MCP Server**（副文案：Add a Custom MCP Server）。

2. **JSON 编辑子页 / 抽屉 / 路由**
   - 从「新建」「编辑」进入；展示语法高亮 + **JSON Schema 校验错误**（与后端 PUT 报错对齐）。
   - 保存成功返回列表并触发 `reconnect`/刷新状态。

### 6.2 工程约束

- API 封装在 `src/lib/api/`，列表与编辑器逻辑放在 `features/mcp/` hooks。
- **禁止**按插件 ID 特判页面行为；本功能为宿主全局设置，与插件页解耦。

---

## 7. 交付阶段建议

| 阶段 | 内容 |
|------|------|
| **MVP** | SQLite 持久化配置；stdio + http 各一条通路验证；servers CRUD；handshake → catalog；Console 列表 + JSON 编辑；`invoke` 打通单工具 |
| **v1** | 策略联动 `allowedTools`；审计字段齐备；stdio 并发与超时治理 |
| **v1.1** | OAuth/令牌态与 Login/Logout UI；tools 折叠详情增强 |

---

## 8. 文档与契约维护

Implementation 前应同步：

- `docs/进度/功能清单_status.md`
- `docs/项目功能/宿主/宿主功能.md`（若有管理端 API）
- `docs/前端方案.md`（路由与接口表）
- 本文档：`docs/项目功能/MCP服务/MCP_Gateway_需求与设计建议.md`

---

## 9. 开放问题（需产品拍板）

1. 管理 API 是否与插件 API **同级无鉴权**（仅 dev），还是首版就上 **管理员令牌**？
2. JSON 编辑器是否允许直接写 **明文密钥**，还是强制引导用系统环境变量引用（例如 `env.REF_TO_SECRET`）？
3. HTTP MCP 在具体版本上首选 **SSE** 还是 **Streamable HTTP**，以便依赖锁定。
