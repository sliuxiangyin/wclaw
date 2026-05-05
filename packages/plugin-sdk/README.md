# @wclaw/plugin-sdk

宿主加载的 **runtime_plugin** / **command_plugin** 与宿主之间的 **TypeScript 类型契约**（无宿主实现依赖）。

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
