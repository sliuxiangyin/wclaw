# `runtime_plugin` 开发检查清单（PR 评审用）

用途：面向 `kind = runtime_plugin` 的专项核验。  
说明：此清单是 `插件开发检查清单.md` 的补充，不替代通用检查。

---

## 1. 清单与会话模型

- [ ] `plugin.json.kind` 明确为 `runtime_plugin`。
- [ ] `sessionProvider.mode`（`single`/`multi`）与实现一致。
- [ ] `decorateSessions` / 会话行 `ui` 中的欢迎语、建议词与真实交互路径一致（清单不再包含 `guide`）。
- [ ] 若为多会话模式，默认会话与账号会话职责边界清晰。

---

## 2. 核心回合能力（`executeTurn`）

- [ ] `executeTurn` 能稳定处理普通消息与命令消息（如有）。
- [ ] 返回始终为 `PluginTurnHandleResult` 且包含 `text`。
- [ ] `continue` 语义明确，不会误触发宿主后续链路。
- [ ] 对外部依赖失败、配置缺失、参数异常有可读降级输出。

---

## 3. 会话扩展能力

- [ ] `decorateSessions`（若实现）仅负责展示增强，不承载重业务逻辑。
- [ ] `clearSession`（若实现）能正确清理会话侧状态与资源。
- [ ] 会话清理失败不会导致宿主主流程不可用。
- [ ] 会话展示字段（如 `title`、`persistence`）与业务语义一致。

---

## 4. 编排完成回流（`executeCompleted`）

- [ ] `executeCompleted`（若实现）仅处理回流，不重做主编排。
- [ ] 回流失败有错误隔离，不影响宿主已落库结果。
- [ ] 对 `metadata`、`traceId` 的使用有防御性处理。
- [ ] 外部渠道不可用时有可观测日志与重试策略（如适用）。

---

## 5. 调度能力（`getScheduledTasks` / `runScheduledTask`）

- [ ] 任务定义字段完整合理（`intervalMs`、`timeoutMs`、`maxRetry` 等）。
- [ ] `runScheduledTask` 单次执行可控，不长期占用事件循环。
- [ ] 任务失败可观测，可定位到 taskId、错误类型与重试状态。
- [ ] 多任务并存时不会互相污染共享状态。

---

## 6. 状态管理与资源释放

- [ ] 插件内状态按会话/账号隔离，避免串话。
- [ ] 退出、注销、关闭会话等路径能释放外部连接与临时资源。
- [ ] 不依赖进程重启来恢复一致性。
- [ ] 持久化策略（`persist`/`ephemeral`）与业务预期一致。

---

## 7. 与宿主能力协作（可选）

- [ ] 使用 LLM 时 `invokeHostLlm` 调用有 guard/判空。
- [ ] 使用 MCP 时 `invokeHostMcpTool` 调用有 guard/判空。
- [ ] 需要释放 MCP 会话时正确调用 `releaseHostMcpContext`。
- [ ] 宿主能力缺失时输出用户可读提示，不抛裸错误。

---

## 8. 合并前结论

- [ ] 已完成最小联调：至少一轮正常消息 + 一轮失败分支。
- [ ] 多会话或调度能力（若启用）已完成专项联调。
- [ ] 我确认该 `runtime_plugin` 在当前宿主契约下可稳定运行。

评审人：`______`  
提交时间：`______`

