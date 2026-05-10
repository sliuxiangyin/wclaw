# Prompt2Plugin：LLM 与通用提示词链 — 实现 TODO

更新时间：2026-05-10  

本清单聚焦 **宿主 LLM（`invokeHostLlm`）** 与 **[通用提示词规范 v1](./Prompt2Plugin_通用提示词规范_v1.md)**（Prompt A–E、JSON 契约、§9 日志）在 **`prompt2plugin-studio`** 侧的落地；与 [Prompt2Plugin_开发TODO.md](./Prompt2Plugin_开发TODO.md)（v1 命令骨架）互补。  

范围约定：**v1** 仍以 `init/spec/generate/validate/test/promote/rollback/status` 为主；本节任务默认归属 **v1.1**（或专题内「提示词执行链」里程碑），避免阻塞 v1 DoD。

关联文档：

- [Prompt2Plugin_通用提示词规范_v1.md](./Prompt2Plugin_通用提示词规范_v1.md)（§4–§12、§11 命令映射）
- [Prompt2Plugin_v1_实施方案.md](./Prompt2Plugin_v1_实施方案.md)
- 宿主：`apps/host-api` 中 `createInvokeHostLlmForPlugin`、`registerPluginIngestAndHostBridge`
- 插件：`plugins/prompt2plugin-studio`、`packages/plugin-sdk`（`PluginRuntimeExtensionDeps.invokeHostLlm`、`guardInvokeHostLlm`）

标记：`[ ]` 待办 / `[~]` 进行中 / `[x]` 已完成  

---

## L0：接线与清单（一切 LLM 的前置）

- [ ] **构造期保存 `invokeHostLlm`**：`Prompt2PluginStudioRuntime` 在 `constructor(deps)` 中保留 `deps.invokeHostLlm`（或经 `guardInvokeHostLlm` 包装），并传入 `PluginTurnHandler`（或等价服务层），避免仅在注释里写「走 LLM」而未接线。
- [ ] **调用前判空与错误映射**：未注入、上游失败、`INVALID_REQUEST` 等统一映射为 `P2P_E_*`（或沿用宿主 code 透传），`p2pJsonTurn` 的 `nextAction` 指向可恢复步骤（如 `/p2p.status`）。
- [ ] **`plugin.json` 自描述**：为 Studio 增加 **`capabilities.llm: true`**（若宿主后续按能力收紧注入，可提前对齐）；`description`/`examples` 中补充「可选 LLM 分析」说明。
- [ ] **配置开关（可选）**：在 `configSchema` 增加如 `enableLlmAnalysis` / `llmModelOverride`，默认关闭或开启由部署方决定，避免无密钥环境误触上游。

---

## L1：Prompt A（任务分析）与 spec 融合（最小「自动完成需求」）

- [ ] **提示词模板落盘**：将规范 §4 的 Prompt A 固化为可版本化资源（如 `plugins/prompt2plugin-studio/resources/prompt-a.md` 或 TS 常量），占位符与 [§3 统一输入模型](./Prompt2Plugin_通用提示词规范_v1.md#3-统一输入模型上游传入) 对齐（`user_goal`、`constraints`、`environment`、`context`）。
- [ ] **输入拼装**：`user_goal` ← `/p2p.spec` 用户正文；`environment.installed_mcps` / `runtime` / `os` 从宿主可提供的窄接口或静态探测（无则填「未知」并显式写入 prompt，满足规范「不得假设未安装 MCP 已可用」）。
- [ ] **`invokeHostLlm` 调用**：`messages` = system（只输出 JSON、禁止 markdown 围栏）+ user（渲染后模板）；`toolPolicy` 保持宿主注入的 **`none`**，不在本阶段调 MCP。
- [ ] **JSON 解析与韧性**：首次 `JSON.parse` 失败时：截断前后噪声、或 **一次**「仅输出合法 JSON」的修复调用；仍失败则返回明确错误，**不写脏数据**。
- [ ] **meta 扩展**：在 `.p2p-meta.json` 的 `spec`（或并列 `analysis`）中持久化解析后的对象（字段与规范 §4 输出 schema 对齐）；`rawPrompt` 仍保留原文。
- [ ] **状态机**：成功解析并落盘后仍将 `status` 置为 **`spec_ready`**（与现有 `generate` 闸门兼容）；失败则保持原状态或 `rejected`（与现有错误语义对齐，二选一并写进实施方案）。
- [ ] **产品入口（二选一，文档 §11）**：  
  - **方案 A**：增强 **`/p2p.spec`**，在写 `rawPrompt` 后异步/同步跑 Prompt A，再写 meta；或  
  - **方案 B**：新增 **`/p2p.analyze`**，仅跑 A，由用户再 `/p2p.spec` 合并（耦合更低、命令更多）。

---

## L2：Prompt B/C/D 与 §9 日志（执行链 v1.1）

- [ ] **命令与规范 §11 对齐（命名与职责）**：在实施方案中登记最终实现名（`generate-prompts` / `run` / `repair` / `converge` 是否带 `/p2p.` 前缀、是否与现有命令冲突）。
- [ ] **Prompt B**：§5 模板 + step log / final_status schema；执行若需 MCP，仅通过 **`invokeHostMcpTool`** + 清单 `mcp.allowedServers`。
- [ ] **Prompt C**：§6，入参为失败 step log + 最近日志；输出 JSON 校验与单次应用策略（写审计、不静默覆盖稳定目录）。
- [ ] **Prompt D**：§7，`go` / `no-go` 门禁与 `next_iteration_focus` 暴露给 `/p2p.status` 或专用字段。
- [ ] **§9 事件落盘**：约定路径（仓库内 `plugins/.drafts/_audit/` 已存在 MVP；若规范要求 `var/logs/prompt2plugin/`，需明确是相对 **host-api cwd** 还是插件 `workspaceDir`，并实现 `analysis.completed`、`execution.step` 等事件类型的追加写）。
- [ ] **traceId / taskId**：与现有 `createTraceId`、审计 JSONL 对齐，便于跨宿主日志关联。

---

## L3：Prompt E（脚本固化）与现有 `generate` 的关系

- [ ] **边界定义**：Prompt E 产出的是「可执行脚本/提示词包」还是「直接改 `command_plugin` 的 `src/runtime.ts`」；与 **`/p2p.generate`** 模板生成是否合并、谁先谁后（建议：`go` 之后才允许 E 或增强版 generate）。
- [ ] **门禁**：仅当 Prompt D 返回 **`go`** 且 `confidence` / 策略满足阈值时，才允许写晋升候选文件或触发 CI。
- [ ] **与生成目标一致**：目标插件 **`kind` 恒为 `command_plugin`**（见 README 与实施方案），提示词链不得按 `runtime_extension` 假设能力集。

---

## L4：体验、安全与运维

- [ ] **人机确认**：首次写入结构化 `analysis` 前，可选「仅预览 JSON」模式或管理台开关，避免静默覆盖用户意图。
- [ ] **成本与限流**：单次 spec 最多 N 次 LLM 调用、token 上限、超时；写入 `lastValidation` 或审计。
- [ ] **回滚与草稿重置**：与 [Prompt2Plugin_开发TODO.md](./Prompt2Plugin_开发TODO.md) 中「阶段回退」需求协同（若新增 `/p2p.reset-stage`，需与 LLM 写入字段兼容）。
- [ ] **文档同步**：完成 L1 后更新 [通用提示词规范_v1.md](./Prompt2Plugin_通用提示词规范_v1.md) §11 中「对接命令」为**实际已实现**名称；更新 [README](./README.md) 中 v1 / v1.1 边界描述。

---

## 验收（本节 DoD）

1. 在未配置 LLM 的宿主上，Studio **不崩溃**，且错误信息指向配置 LLM 或关闭开关。  
2. 在已配置 LLM 的宿主上，**一次** `/p2p.spec`（或 `/p2p.analyze`）可产生 **可解析** 的 §4 JSON，并能在 `.p2p-meta.json` 中查看。  
3. 解析失败时 **不破坏** 已有 `rawPrompt` 与 revision 单调性（或明确文档化例外）。  
4. L2 完成后：至少一条端到端记录满足 §9 最小字段（`time`、`traceId`、`pluginId`、`event`、`payload`）。

---

维护约定：完成条目后改 `[x]`，并在 `Prompt2Plugin_v1_实施方案.md` 或 `Prompt2Plugin_开发TODO.md` 顶部「现状快照」补一句，避免与 v1 骨架清单漂移。
