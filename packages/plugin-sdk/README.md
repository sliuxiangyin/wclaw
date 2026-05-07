# @wclaw/plugin-sdk

宿主加载的 **runtime_plugin** / **command_plugin** 与宿主之间的 **TypeScript 类型契约**（无宿主实现依赖）。

## 文档（本包 `docs/`）

| 文档 | 说明 |
|------|------|
| [插件开发文档](./docs/插件开发文档.md) | 目录约定、`plugin.json`、实现清单与自测要点 |
| [插件开发检查清单](./docs/插件开发检查清单.md) | 通用 PR 评审与提测核验清单 |
| [command_plugin开发检查清单](./docs/command_plugin开发检查清单.md) | `command_plugin` 专项评审清单 |
| [runtime_plugin开发检查清单](./docs/runtime_plugin开发检查清单.md) | `runtime_plugin` 专项评审清单 |
| [插件架构文档](./docs/插件架构文档.md) | 宿主–插件分层、deps 注入、扩展点正交性 |
| [插件sdk使用文档](./docs/插件sdk使用文档.md) | 安装、`PluginRuntimeExtension`、工具函数与 `BasePluginRuntime` |

## 运行时入口

- **`plugin.json` → `entry`** 指向的 ESM 模块须 **`export default class`**。
- 宿主在启动时执行 **`new DefaultExport({ pluginId, publish })`**（可选 **`ingestExternalUserTurn`** 由宿主注入），得到 **`PluginRuntimeExtension`** 实例。
- 一轮输入：**`executeTurn(ctx: PluginTurnContext)`**；编排落库后回流：**`executeCompleted(input: PluginExecuteCompletedInput)`**。
- 与会话列表 / 清会话 / 调度正交：**`decorateSessions`**、**`clearSession`**、**`getScheduledTasks`**、**`runScheduledTask`**。

详见 `src/runtime-contract.ts` 与 `docs/插件/插件实例与编排.md`。

## 构建

```bash
pnpm --filter @wclaw/plugin-sdk build
```

## 与内嵌子项目

- **`plugins/weixin-bridge/openclaw-weixin/`**：勿为对齐本包契约而修改该子树；仅维护 **weixin-bridge 外层 `runtime`**。
