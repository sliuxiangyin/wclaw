# Prompt2Plugin v1 实施方案

更新时间：2026-05-07

本文是 `Prompt2Plugin` 的开发执行稿，目标是把“需求描述 -> 插件草稿 -> 自动校验 -> 联调测试 -> 稳定发布”做成标准化流水线。

---

## 1. 目标与非目标

### 1.1 目标

1. 用一个 `command_plugin`（开发插件）统一承载插件生成与校验。
2. 所有生成代码默认进入草稿区，禁止直接覆盖稳定插件。
3. 通过 `/` 命令完成最小闭环：`init -> spec -> generate -> validate -> test -> promote`。
4. 校验标准与 `@wclaw/plugin-sdk/docs` 文档一致，确保“按文档开发”可被机器执行。

### 1.2 非目标

1. v1 不追求一次生成完整业务插件，只保证“可加载 + 可联调 + 可演进”。
2. v1 不负责线上全自动灰度，灰度与回滚仍由宿主治理链路执行。
3. v1 不改造宿主核心插件加载协议（沿用现有 `plugin.json + export default class`）。

---

## 2. 方案结论（拍板）

采用 **“开发插件（builder）+ 草稿隔离目录”** 模式：

1. 新建 `command_plugin`：`prompt2plugin-studio`。
2. `prompt2plugin-studio` 接收需求并生成草稿插件。
3. 草稿目录通过校验后，再晋升到稳定目录。

该模式相比“直接在目标插件目录开发”有更好治理性：可复用、可审计、可回滚、可自动化。

---

## 3. 目录与状态存储

```txt
plugins/
  prompt2plugin-studio/
    plugin.json
    dist/runtime.mjs
  .drafts/
    <plugin-id>/
      plugin.json
      src/
      dist/
      README.md
      .p2p-meta.json
```

`.p2p-meta.json` 最小结构建议：

```json
{
  "pluginId": "demo-plugin",
  "kind": "runtime_plugin",
  "status": "initialized",
  "revision": 1,
  "spec": {
    "rawPrompt": "",
    "capabilities": {},
    "notes": []
  },
  "lastValidation": null,
  "lastTest": null,
  "updatedAt": ""
}
```

---

## 4. 命令协议（MVP）

由 `prompt2plugin-studio` 在 chat 中提供以下命令：

1. `/p2p.init <plugin-id> --kind runtime_plugin|command_plugin`
2. `/p2p.spec "<需求描述>"`
3. `/p2p.generate`
4. `/p2p.validate`
5. `/p2p.test`
6. `/p2p.promote`
7. `/p2p.rollback <revision>`
8. `/p2p.status`

返回统一结构化文本，至少包含：

- `traceId`
- `pluginId`
- `revision`
- `status`
- `nextAction`

---

## 5. 状态机与门禁

状态枚举：

- `initialized`
- `spec_ready`
- `generated`
- `validated`
- `tested`
- `promoted`
- `rejected`

门禁规则：

1. `generate` 前必须有 `spec`。
2. `validate` 前必须有生成产物（`plugin.json + entry`）。
3. `test` 前必须 `validated`。
4. `promote` 前必须 `tested` 且关键检查项全通过。
5. 任一关键步骤失败进入 `rejected`，仅允许 `spec/generate` 继续修复。

---

## 6. 生成策略（v1）

### 6.1 产物范围

`/p2p.generate` 至少生成：

1. `plugin.json`
2. `src/runtime.ts`（或直接 `dist/runtime.mjs`）
3. `README.md`
4. `.p2p-meta.json` 更新（状态、revision、变更摘要）

### 6.2 代码约束

1. 入口必须 `export default class`。
2. 运行时契约对齐 `PluginRuntimeExtension`。
3. `executeTurn` 返回 `{ text, continue?, persist? }`。
4. 宿主注入能力按可选处理，不允许直接非空断言。
5. 禁止生成宿主内部路径 import。

---

## 7. 校验流水线（必须执行）

`/p2p.validate` 必须包含以下检查：

1. **清单检查**
   - `id/kind/entry/capabilities/configSchema/defaultConfig` 完整性
   - `kind` 与功能声明一致性
2. **契约检查**
   - 默认导出类检查
   - `executeTurn` 返回协议检查
3. **构建检查**
   - 编译输出 ESM
   - `entry` 文件存在且可 `import()`
4. **边界检查**
   - 禁止宿主内部 import
   - 禁止直连 MCP 行为（静态规则）
5. **规则检查**
   - 若命中扫描范围，执行 `pnpm lint:arch`

校验输出格式建议：

```txt
[PASS] manifest.id
[PASS] runtime.default_export_class
[FAIL] runtime.execute_turn_shape
...
```

---

## 8. 测试流水线（必须执行）

`/p2p.test` 最小测试集：

1. 正常输入：返回 `text`。
2. 异常输入：返回可读错误提示。
3. 可选能力缺失：`invokeHostLlm/invokeHostMcpTool` 未注入时不崩溃。
4. `command_plugin` 额外检查：命令参数错误分支。
5. `runtime_plugin` 额外检查：会话路径基础可用性（至少一轮）。

---

## 8.1 执行引擎（按计划逐步执行）

本节定义“按执行计划逐步完成任务”的具体实现方式。  
核心原则：**受控循环，不是无限调用 LLM 直到成功**。

### 8.1.1 执行状态机

建议状态：

1. `initialized`
2. `running`
3. `repairing`
4. `paused`（例如等待人工扫码）
5. `success`
6. `failed`
7. `blocked`

状态切换规则：

- `running -> repairing`：当前步骤失败且可修复。
- `running -> paused`：命中人工前置条件（如登录未完成）。
- `repairing -> running`：修复方案生成并重试。
- 任意状态在超预算或关键失败时进入 `failed` 或 `blocked`。

### 8.1.2 预算与门限（必须）

每个任务必须配置执行预算，避免死循环：

1. `maxSteps`：最大步骤数（建议默认 `50`）。
2. `maxRetriesPerStep`：单步最大重试次数（建议默认 `2`）。
3. `maxDurationSec`：任务最大时长（建议默认 `900`）。
4. `maxLlmCalls`：任务最大 LLM 调用次数（建议默认 `30`）。

任一门限触发即停止并输出终局状态，不允许继续盲目重试。

### 8.1.3 单步执行流程（Step Runner）

对 `execution_plan` 中每个步骤按以下流程执行：

1. 读取步骤目标（`goal`）与依赖（`depends_on`）。
2. 组装“本步最小上下文”并调用一次 LLM 产出动作方案。
3. 执行 MCP/工具动作并收集证据（URL、title、snapshot、错误）。
4. 写入 `execution.step` 日志。
5. 进行步骤判定：
   - 成功：进入下一步
   - 失败：进入 `repairing`
   - 阻塞：进入 `paused/blocked`

### 8.1.4 修复分支（局部重试）

修复必须遵循“最小影响”：

1. 调用失败修复 Prompt，生成最多 3 个修复方案。
2. 只重试失败步骤，必要时重试“失败步骤 + 后续 N 步”。
3. 达到 `maxRetriesPerStep` 后不再重试，任务失败或阻塞退出。

禁止行为：

- 每次失败都全流程重跑。
- 无门限重复调用 LLM。

### 8.1.5 终局输出

任务终止时输出统一结果：

1. `status`：`success|failed|blocked`
2. `completedSteps`
3. `failedSteps`
4. `nextAction`
5. `scriptableScore`

并触发收敛评估（`go/no-go`）决定是否进入脚本固化。

### 8.1.6 伪代码（实现参考）

```ts
async function runTask(task: TaskInput, budget: Budget): Promise<TaskResult> {
  const state = createState(task, budget);

  while (!state.terminated) {
    if (overBudget(state)) return finish(state, "failed", "budget_exceeded");

    const step = getCurrentStep(state);
    if (!step) return finish(state, "success", "all_steps_completed");

    const plan = await llmPlanStep(step, buildStepContext(state));
    state.llmCalls += 1;
    if (state.llmCalls > budget.maxLlmCalls) return finish(state, "failed", "llm_budget_exceeded");

    const exec = await executeTool(plan);
    appendStepLog(state, step, exec);

    if (exec.result === "success") {
      moveNext(state);
      continue;
    }

    if (exec.result === "blocked") {
      return finish(state, "blocked", "external_precondition_required");
    }

    if (step.retries >= budget.maxRetriesPerStep) {
      return finish(state, "failed", "step_retry_exhausted");
    }

    const fix = await llmRepairStep(step, exec, recentLogs(state));
    step.retries += 1;
    applyFix(step, fix);
  }

  return finish(state, "failed", "unexpected_exit");
}
```

---

## 9. 晋升与回滚策略

### 9.1 promote（草稿 -> 稳定）

`/p2p.promote` 前置条件：

1. 最新 revision 已 `validated + tested`。
2. 关键检查项全通过。
3. 目标稳定目录无未确认冲突。

执行行为：

1. 备份当前稳定版本为历史 revision。
2. 拷贝草稿到 `plugins/<plugin-id>/`。
3. 记录 promote 审计信息（时间、traceId、revision、操作者）。

### 9.2 rollback

`/p2p.rollback <revision>`：

1. 只允许回滚到“已 promote 的历史版本”。
2. 回滚后自动触发一次 `validate`（快速校验）。
3. 回滚结果写入审计日志。

---

## 10. 与现有文档对齐清单

`Prompt2Plugin` 实施必须引用以下文档作为规则源：

1. `packages/plugin-sdk/docs/插件开发文档.md`
2. `packages/plugin-sdk/docs/插件开发检查清单.md`
3. `packages/plugin-sdk/docs/command_plugin开发检查清单.md`
4. `packages/plugin-sdk/docs/runtime_plugin开发检查清单.md`
5. `docs/项目功能/插件插件配置.md`

要求：

- 生成时自动提示关键规则。
- 校验结果按“清单条目”输出。
- promote 时强制关键条目全绿。

---

## 11. 开发任务拆分（建议 5 天）

### Day 1：骨架与命令路由

1. 建立 `prompt2plugin-studio` 插件骨架。
2. 打通 `/p2p.init`、`/p2p.status`。
3. 完成 `.p2p-meta.json` 读写。

### Day 2：生成器

1. 实现 `/p2p.spec` 持久化。
2. 实现 `/p2p.generate` 产物模板。
3. 打通 revision 自增与变更摘要。

### Day 3：校验器

1. 实现 manifest/契约/加载校验。
2. 接入 `lint:arch`（条件执行）。
3. 输出统一校验报告格式。

### Day 4：测试与晋升

1. 实现 `/p2p.test` 最小测试集。
2. 实现 `/p2p.promote` 与历史版本记录。
3. 实现 `/p2p.rollback`。

### Day 5：联调与文档

1. 用两个样例插件跑完整链路（一个 `command_plugin`，一个 `runtime_plugin`）。
2. 补齐异常分支与审计日志。
3. 更新 README 与操作手册。

---

## 12. v1 验收标准（DoD）

1. 输入一句需求可生成可加载草稿插件（3 分钟内）。
2. 草稿插件可跑通 `validate + test` 最小链路。
3. 校验不通过时 `promote` 被拒绝且有明确原因。
4. promote 后稳定插件可被宿主加载并执行一轮。
5. rollback 可恢复到上个稳定版本并通过快速校验。
6. 全链路有可审计记录：`traceId/pluginId/revision/status`。

---

## 13. 风险与规避

1. 生成代码质量不稳定
   - 规避：模板优先 + 严格校验 + 人工复核关口。
2. 草稿目录膨胀
   - 规避：按 revision 保留策略定期归档。
3. 规则漂移
   - 规避：所有校验规则从文档源自动映射，版本化管理。
4. promote 冲突
   - 规避：promote 前做目标目录变更检测并要求确认。

