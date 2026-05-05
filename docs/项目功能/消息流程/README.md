# 消息流程总览

## 文档范围

本目录用于描述 chat 消息在宿主与插件体系中的编排、分流、上下文并入与展示规则。

## 文档索引

- [chat_runtime_plugin.md](./chat_runtime_plugin.md)
  - `runtime_plugin` 会话主流程
  - 默认 LLM 路径、命令分流、回流并入规则

- [chat_command_plugin_ephemeral_no_context.md](./chat_command_plugin_ephemeral_no_context.md)
  - `command_plugin` 的 `ephemeral_no_context` 执行流程
  - 执行不带历史上下文，结果可并入后续 runtime LLM 上下文

- [command_plugin_ephemeral_with_context.md](./command_plugin_ephemeral_with_context.md)
  - `command_plugin` 的 `ephemeral_with_context` 执行流程
  - 命令触发执行、带上下文、可接入 LLM

- [command_plugin_isolated_chat.md](./command_plugin_isolated_chat.md)
  - `command_plugin` 的 `isolated_chat` 进入/驻留/退出流程
  - `/close` 退出与回流并入规则

- [chat消息架构设计.md](./chat消息架构设计.md)
  - 消息编排分层架构与设计模式
  - 解耦策略与最小落地阶段

## 全局口径（重要）

1. `runtime_plugin` 作为当前主会话承载；命中命令时分流到对应 `command_plugin` 执行内核。  
2. `command_plugin` 上下文为一次性（ephemeral）语义：单次执行结束后默认不保留执行态，下次执行重开。  
3. 插件执行结果回流后可按规则并入后续 `runtime_plugin` 的 LLM 上下文（通过 `llmEligible/contextSummary` 控制）。  
4. 每条消息需带来源标记（`runtime` 或 `plugin:<pluginId>`），前端底部展示来源标签。  
