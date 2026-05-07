# 插件 SDK 使用文档（@wclaw/plugin-sdk）

本包名称：**`@wclaw/plugin-sdk`**。用途：为 **`runtime_plugin` / `command_plugin`** 提供与宿主对齐的 **TypeScript 类型契约** 及少量 **无宿主依赖** 的辅助函数/基类。

---

## 1. 安装与入口

在工作区 Monorepo 中，通常在插件包的 `package.json` 中加入：

```json
{
  "devDependencies": {
    "@wclaw/plugin-sdk": "workspace:*"
  }
}
```

从入口 **`@wclaw/plugin-sdk`** 可导入的类型与符号以 **`src/index.ts`**（构建后为 `dist/index.d.ts`）为准。

构建本包：

```bash
pnpm --filter @wclaw/plugin-sdk build
```

---

## 2. 核心类型：`PluginRuntimeExtension`

插件入口模块类型（概念上 implements）：

```ts
import type {
  PluginRuntimeExtension,
  PluginRuntimeExtensionDeps,
  PluginTurnContext,
  PluginTurnHandleResult
} from "@wclaw/plugin-sdk";

export default class MyPlugin implements PluginRuntimeExtension {
  constructor(private readonly deps: PluginRuntimeExtensionDeps) {}

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    // …
    return { text: "ok", continue: false };
  }
}
```

**模块形状**（供类型校验 `default` 导出）：

```ts
import type { PluginRuntimeExtensionModule } from "@wclaw/plugin-sdk";
const mod: PluginRuntimeExtensionModule = { default: MyPlugin };
```

### 2.1 `PluginTurnContext`

| 字段 | 说明 |
|------|------|
| `sessionId` | 当前会话 id |
| `message` | 用户可见正文 |
| `config` | 宿主合并后的插件配置对象 |
| `argv?` | 宿主可选注入：`command` + `args[]` |
| `emitAssistantDelta?` | 流式输出增量 |
| `emitPluginActivity?` | 阶段事件；`data.summary` 可被控制台用作整段说明 |

### 2.2 `PluginTurnHandleResult`

| 字段 | 说明 |
|------|------|
| `text` | **必填**，本轮文本结果 |
| `continue?` | 默认等价于允许宿主停止后续链路；为 `true` 时可继续如 LLM |
| `persist?` | **`PluginChatPersistRow[]`**，额外落库助手/用户消息 |

### 2.3 编排后回流：`executeCompleted`

```ts
import type { PluginExecuteCompletedInput } from "@wclaw/plugin-sdk";

// PluginExecuteCompletedInput: sessionId, reply, metadata?, traceId?
```

### 2.4 会话列表：`decorateSessions`

返回 **`PluginSessionRow[]`**。字段 **`persistence`**：`persist` | `ephemeral`；**`forceExecuteTurn`**：`true` 时宿主可对该会话优先走 **`executeTurn`**（与宿主实现一致时再依赖）。

### 2.5 调度

- **`PluginScheduledTask`**：`taskId`、`intervalMs`、`jitterMs?`、`timeoutMs?`、`maxRetry?`、`backoff?`、`enabled?`
- **`runScheduledTask(taskId, ctx)`**，其中 **`PluginScheduledTaskContext`** 仅有 **`config`**

### 2.6 外部进线与宿主桥（类型）

- **`ExternalUserTurnInput` / `ExternalUserTurnResult`**：`deps.ingestExternalUserTurn`
- **`HostMcpInvokeInput` / `HostMcpInvokeResult`**、`HostMcpReleaseContextInput`：MCP
- **`HostLlmInvokeInput` / `HostLlmInvokeResult`**、`HostLlmMessage`：LLM

插件实现中调用前须判断宿主是否注入对应函数。

---

## 3. 工具函数

### 3.1 `toTurnResult`

统一构造 **`PluginTurnHandleResult`**，默认值 **`continue=false`**、`persist=[]`。

```ts
import { toTurnResult } from "@wclaw/plugin-sdk";

return toTurnResult("完成", {
  continue: true,
  persist: [{ sessionId: ctx.sessionId, role: "assistant", content: "…" }]
});
```

### 3.2 `toSessionRow`

构造 **`decorateSessions`** 单行，默认 **`persistence=persist`**、**`forceExecuteTurn=false`**、**`updatedAt=now`**。

```ts
import { toSessionRow } from "@wclaw/plugin-sdk";

return [
  toSessionRow({
    sessionId: "default",
    title: "引导",
    persistence: "ephemeral"
  })
];
```

---

## 4. 桥可用性：`guard*` 辅助函数

在使用 **`invokeHostMcpTool`** 或 **`invokeHostLlm`** 前检测注入，避免各插件复制长文案：

```ts
import { guardInvokeHostMcpTool, guardInvokeHostLlm } from "@wclaw/plugin-sdk";

const mcp = guardInvokeHostMcpTool({
  invokeHostMcpTool: this.deps.invokeHostMcpTool,
  label: this.deps.pluginId
});
if (!mcp.ok) {
  return { text: mcp.message, continue: false };
}

const llm = guardInvokeHostLlm({ invokeHostLlm: this.deps.invokeHostLlm });
if (!llm.ok) {
  return { text: llm.message, continue: false };
}
```

返回值类型：**`GuardInvokeHostMcpToolResult` / `GuardInvokeHostLlmResult`**（含 `ok: true` 时的 `invoke`）。

---

## 5. 可选基类：`BasePluginRuntime`

**`abstract class BasePluginRuntime`** 在构造函数中接收 **`PluginRuntimeExtensionDeps`** 与可选 **`BasePluginRuntimeOptions`**：

```ts
import { BasePluginRuntime, type PluginRuntimeExtensionDeps } from "@wclaw/plugin-sdk";

type Opts = { requiredBridges?: Array<"mcp" | "llm" | "ingest"> };

class MyRuntime extends BasePluginRuntime {
  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps, { requiredBridges: ["mcp"] });
  }

  async executeTurn(ctx /* PluginTurnContext */) {
    this.ensureRequiredBridges(); // 若缺桥抛 PluginBridgeError
    await this.workspace.ensureDir("cache");
    const out = await this.mcp.call(ctx, {
      toolId: "server/tool",
      arguments: {}
    });
    this.publish({ topics: ["notification"], notification: { /* … */ } });
    return this.toTurnViaHelpers(ctx);
  }
}

export default MyRuntime;
```

### 5.1 受保护成员（摘录）

| 成员 | 作用 |
|------|------|
| **`publish`** | 包装 **`deps.publish`**
| **`emitPluginActivity` / `emitAssistantDelta`** | 透传上下文回调
| **`this.mcp`** | `contextKey`、`call`、`callRaw`、`destroy`（会话维度的默认 **`contextKey`** 形如 **`pluginId:sessionId`**）
| **`this.llm`** | `call`、`text`
| **`this.ingest`** | `call`
| **`this.workspace`** | `root`、`path`、`ensureDir`、`readText`、`writeJson` 等（依赖 **`workspaceDir`**；路径越界抛 **`PluginBridgeError`**）

### 5.2 `PluginBridgeError`

**`bridge`**：`"mcp" | "llm" | "ingest"`；**`code`**：如 **`MISSING_BRIDGE`**、宿主返回的错误码或 **`MISSING_WORKSPACE` / `WORKSPACE_PATH_ESCAPE`**。

---

## 6. 类型一览（从入口导出）

与 **`dist/index.d.ts`** 对齐的导出包括：

**自 `runtime-contract`**：`ExternalUserTurnInput`、`ExternalUserTurnResult`、`HostLlmMessage`、`HostLlmInvokeInput`、`HostLlmInvokeResult`、`HostMcpInvokeInput`、`HostMcpInvokeResult`、`HostMcpReleaseContextInput`、`HostMcpReleaseContextResult`、`PluginChatPersistRow`、`PluginClearSessionContext`、`PluginExecuteCompletedInput`、`PluginHostPublishInput`、`PluginRuntimeExtension`、`PluginRuntimeExtensionDeps`、`PluginRuntimeExtensionModule`、`PluginScheduledTask`、`PluginScheduledTaskContext`、`PluginSessionRow`、`PluginTurnContext`、`PluginTurnHandleResult`。

**实现辅助**：`toTurnResult`、`toSessionRow`、`guardInvokeHostMcpTool`、`guardInvokeHostLlm` 及各 `Guard*` 类型、`BasePluginRuntime`、`PluginBridgeError`、`BasePluginRuntimeOptions`、`RuntimeBridgeName`。

若需精读字段注释，请参阅仓库内源码：**`packages/plugin-sdk/src/runtime-contract.ts`**。

---

## 7. 相关文档

- [插件开发文档](./插件开发文档.md)
- [插件架构文档](./插件架构文档.md)
- [插件实例与编排](../../docs/插件/插件实例与编排.md)
