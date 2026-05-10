# Prompt2Plugin 通用提示词规范 v1

更新时间：2026-05-07

同专题：[索引](./README.md)、[开发目标](./Prompt2Plugin_开发目标.md)、[实施方案](./Prompt2Plugin_v1_实施方案.md)。

目标：为任意任务场景提供统一的提示词工程方法，先分析能力与 MCP 依赖，再自动生成可执行提示词，最后按统一契约收敛为脚本/插件能力。

---

## 1. 适用范围

本规范适用于：

1. 需要 AI + MCP 执行多步骤任务的场景（网页自动化、数据抓取、代码执行、文件处理等）。
2. 需要把“对话探索”逐步沉淀为“稳定脚本/插件”的场景。
3. 需要跨场景复用提示词模板，而不是为单个业务手写 prompt 的场景。

---

## 2. 三层模型（固定流程）

1. **任务分析层**：只分析，不执行。产出能力需求与 MCP 依赖。
2. **提示词生成层**：生成三段式执行提示词（启动/修复/收敛）。
3. **执行收敛层**：按统一 JSON 契约执行、记录、评估、固化。

硬规则：

- 未完成任务分析，不进入执行。
- 未定义输出契约，不进入自动修复。
- 未达到收敛门槛，不进入脚本固化。

---

## 3. 统一输入模型（上游传入）

```json
{
  "user_goal": "",
  "constraints": {
    "time_budget_sec": 0,
    "safety_level": "low|medium|high",
    "must_not": []
  },
  "environment": {
    "installed_mcps": [],
    "runtime": "node20",
    "os": "linux"
  },
  "context": {
    "target_url": "",
    "credentials_mode": "human_login|provided_secret|none",
    "notes": []
  }
}
```

---

## 4. Prompt A：任务分析（MCP 依赖判定）

用途：识别能力缺口、推荐 MCP、给出执行计划，不直接执行任务。

模板：

```text
你是任务编排分析器。先不要执行任务，只输出规划结果。

输入任务：
{{user_goal}}

约束：
{{constraints}}

环境：
{{environment}}

上下文：
{{context}}

请输出 JSON（不得输出额外解释）：
{
  "task_summary": "...",
  "required_capabilities": [
    "browser_automation|filesystem|http_fetch|code_exec|scheduler|llm_reasoning"
  ],
  "recommended_mcps": [
    {
      "server": "...",
      "reason": "...",
      "required": true
    }
  ],
  "missing_mcps": [
    {
      "capability": "...",
      "impact": "...",
      "fallback_plan": "..."
    }
  ],
  "execution_plan": [
    {
      "step": 1,
      "goal": "...",
      "depends_on": []
    }
  ],
  "risk_level": "low|medium|high",
  "success_criteria": [
    "..."
  ]
}

规则：
1) 不得假设未安装 MCP 已可用；
2) required=true 仅用于不可替代能力；
3) 必须提供无 MCP 降级策略。
```

---

## 5. Prompt B：任务启动（执行入口）

用途：按计划开始执行并结构化记录每一步。

模板：

```text
你是执行代理。按执行计划逐步完成任务，并严格输出结构化日志。

任务目标：
{{user_goal}}

执行计划：
{{execution_plan}}

可用能力/MCP：
{{available_capabilities_and_mcps}}

成功标准：
{{success_criteria}}

执行规则：
1. 每步执行前先输出 intent；
2. 每步执行后输出 step log（JSON）；
3. 失败时不要直接终止，先诊断并给出修复建议；
4. 达到终止条件（成功/阻塞/超预算）后输出 final_status。

step log JSON schema：
{
  "step_id": "",
  "intent": "",
  "tool_or_mcp": "",
  "action": "",
  "target": "",
  "result": "success|failed|blocked",
  "evidence": {
    "url": "",
    "title": "",
    "snapshot_ref": ""
  },
  "error_code": "",
  "error_message": "",
  "retry_suggestion": "",
  "confidence": 0
}

final_status JSON schema：
{
  "status": "success|failed|blocked",
  "completed_steps": 0,
  "failed_steps": [],
  "next_action": "",
  "scriptable_score": 0
}
```

---

## 6. Prompt C：失败修复（局部重试）

用途：只修失败点，不整链路重跑，降低成本并提升稳定性。

模板：

```text
你是故障修复代理。仅修复失败步骤，并最小影响后续流程。

任务目标：
{{user_goal}}

失败步骤日志：
{{failed_step_log}}

最近上下文日志：
{{recent_logs}}

请输出 JSON：
{
  "root_causes": [
    {"reason": "", "probability": 0.0}
  ],
  "fix_plan": {
    "selector_or_target_update": [],
    "wait_or_timeout_update": "",
    "precondition_checks": []
  },
  "retry_plan": {
    "max_retry": 0,
    "retry_scope": "failed_step_only|failed_and_next_n",
    "n": 0
  },
  "expected_risk": "low|medium|high"
}

规则：
1) 优先局部修复，不得默认全流程重跑；
2) 修复方案最多 3 个，按成功概率排序；
3) 必须给出可回退方案。
```

---

## 7. Prompt D：收敛评估（是否可脚本化）

用途：判断当前流程是否已稳定到可以固化为脚本/插件。

模板：

```text
你是收敛评估器。根据执行日志判断是否可固化为脚本。

任务目标：
{{user_goal}}

完整执行日志：
{{all_logs}}

请输出 JSON：
{
  "stable_steps": [],
  "unstable_steps": [
    {"step_id": "", "reason": ""}
  ],
  "required_hardening": [
    "assertion",
    "fallback_selector",
    "timeout_retry",
    "idempotency_guard"
  ],
  "script_structure_suggestion": [
    "init",
    "precheck",
    "execute",
    "verify",
    "cleanup"
  ],
  "go_no_go": "go|no-go",
  "confidence": 0,
  "next_iteration_focus": []
}

规则：
1) 只有稳定性达标才返回 go；
2) no-go 必须指出最小补齐项；
3) 输出必须可直接转为工程任务。
```

---

## 8. Prompt E：脚本固化（可选）

用途：在 `go` 后生成脚本，作为插件实现输入。

模板：

```text
你是脚本固化器。仅基于已验证通过的稳定步骤生成脚本，不新增未验证动作。

输入：
- user_goal: {{user_goal}}
- stable_steps: {{stable_steps}}
- required_hardening: {{required_hardening}}

输出：
1) 脚本代码
2) 配置项（timeout/retry/targets）
3) 断言与失败处理
4) 最小测试用例（成功1 + 失败1）
```

---

## 9. 统一日志契约（强制）

所有阶段必须产出可机读 JSON，建议落盘到：

- `var/logs/prompt2plugin/<task-id>.jsonl`

事件类型建议：

1. `analysis.completed`
2. `execution.step`
3. `repair.proposed`
4. `repair.applied`
5. `convergence.evaluated`
6. `script.generated`

最小通用字段：

```json
{
  "time": "",
  "traceId": "",
  "taskId": "",
  "pluginId": "",
  "event": "",
  "payload": {}
}
```

---

## 10. 场景扩展方法（关键）

新增场景时不改框架，只改变量：

1. `user_goal`
2. `constraints`
3. `context`
4. `success_criteria`

不要改动：

1. 三段式提示词流程
2. 输出 JSON 契约
3. 收敛门禁规则

---

## 11. 与 Prompt2Plugin v1 的集成建议

**生成侧约束**：`prompt2plugin-studio` v1 产出的目标插件 **`kind` 固定为 `command_plugin`**；提示词、模板与收敛规则不得按 `runtime_extension` 假设生成清单或能力集。

对接 `prompt2plugin-studio` 命令：

1. `/p2p.spec`：调用 Prompt A（任务分析）
2. `/p2p.generate-prompts`：调用 Prompt B/C/D 生成三段式提示词包
3. `/p2p.run`：执行 Prompt B 并持续写 step log
4. `/p2p.repair`：执行 Prompt C
5. `/p2p.converge`：执行 Prompt D
6. `/p2p.generate-script`：在 go 后执行 Prompt E

---

## 12. 验收标准（DoD）

1. 任意新任务可在不改代码的情况下生成三段式提示词包。
2. MCP 缺失时可输出明确降级路径，不会盲目执行。
3. 失败修复可局部重试，避免全链路重复成本。
4. 收敛评估可稳定判断 go/no-go 并给出下一步任务。
5. 生成脚本只基于稳定步骤，且具备最小断言与失败处理。

