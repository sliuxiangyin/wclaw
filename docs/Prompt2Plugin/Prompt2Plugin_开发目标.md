# Prompt2Plugin 开发与进化目标

更新时间：2026-05-09

本文原为《项目蓝图》中 Prompt2Plugin 专题条目的完整展开，现为 **`docs/Prompt2Plugin/`** 下的权威存档，与蓝图中的索引小节互为引用。

同专题：[索引](./README.md)、[实施方案](./Prompt2Plugin_v1_实施方案.md)、[通用提示词规范](./Prompt2Plugin_通用提示词规范_v1.md)。

---

## 1. Prompt2Plugin 进化引擎（插件能力进化路线）

命名：`Prompt2Plugin 进化引擎`  
定位：把“高 token 消耗的对话探索”逐步转为“低 token 消耗的插件执行”。

### 1.1 初衷（成本与复用）

1. 纯对话推进流程在探索期有效，但 token 消耗高。
2. 流程即便已跑通，重复执行仍会为上下文与 skill 解释持续付费。
3. 通过插件沉淀稳定步骤，可把一次性对话能力转为可复用工程资产。

### 1.2 三阶段路线（先跑通，再固化，再进化）

1. 探索期（LLM-first）：
   - 首次任务优先让 LLM 直接执行：网页获取、数据抽取、流程试错。
   - 目标是快速验证“步骤可行性”，而不是一次写对全部代码。
2. 固化期（Pluginize）：
   - 当流程稳定且复用频率高，将步骤转写为插件能力（chat/command/scheduled task）。
   - 由宿主统一承接权限、审计、调度、配置与会话治理。
3. 进化期（Controlled Evolution）：
   - 允许通过插件 chat 生成改进代码，但仅作为“候选版本”。
   - 候选版本必须通过校验与灰度，才能替换稳定版本。

### 1.3 自我进化的发布护栏（必须）

为避免 LLM 代码错误影响插件加载与线上稳定性，采用“提案制发布”：

1. 草稿隔离：新代码进入 `draft`，不得直接覆盖 `stable`。
2. 自动校验：至少通过 `build + lint:arch + manifest 校验 + 导出函数校验`。
3. 沙箱加载：在隔离环境做一次真实加载，失败即拒绝发布。
4. 用例回放：对历史已跑通任务做回放，校验结果结构与关键字段。
5. 灰度放量：先小流量验证错误率与耗时，再全量。
6. 自动回滚：发布后触发阈值（错误率/超时/内存）立即切回旧版。

### 1.4 失败降级策略（保证业务不中断）

- 插件加载失败：标记 `unhealthy`，不影响宿主主流程。
- 插件连续异常：触发熔断并进入 `safe_mode`。
- 熔断期间：回退到 LLM 直跑模式，待插件修复后再恢复。

### 1.5 落地原则（v3 执行口径）

- 原则 1：LLM 负责探索，不直接负责上线。
- 原则 2：插件负责复用，必须可测试、可审计、可回滚。
- 原则 3：宿主负责治理，确保单插件故障不外溢。

---

## 2. Prompt2Plugin v1（可落地实现版）

本节给出一版可以直接开工的实现方案，采用：

- **开发插件（builder）驱动**
- **草稿隔离目录生成**
- **通过 `/` 命令执行“生成-校验-测试-晋升”**

### 2.1 目标与边界

目标：

1. 让“需求文本 -> 可加载插件骨架 -> 可联调插件”成为标准流水线。
2. 把插件开发规范（`plugin.json`、SDK 契约、检查清单）变成自动校验，而不是人工记忆。
3. 任何生成代码默认进入草稿区，不得直接覆盖稳定插件。

边界：

- `Prompt2Plugin` 只负责“生成与治理”，不负责业务插件具体业务正确性兜底。
- 宿主仍是唯一治理中心（加载、权限、策略、审计、灰度、回滚）。

### 2.2 组件形态

新增一个 `command_plugin`：`plugin-dev-studio`（建议 ID：`prompt2plugin-studio`）。

职责：

1. 解析开发需求（自然语言 + 模板变量）。
2. 生成插件草稿（`plugin.json` + runtime 代码 + README + 最小脚本）。
3. 执行自动校验（结构、契约、构建、加载、清单一致性）。
4. 提供联调命令与晋升命令。

### 2.3 目录与隔离策略

约定目录：

```txt
plugins/
  .drafts/
    <plugin-id>/
      plugin.json
      src/
      dist/
      .p2p-meta.json
  <plugin-id>/                # 稳定目录（仅 promote 后写入）
```

规则：

1. `create/update` 只允许写入 `plugins/.drafts/<plugin-id>`。
2. `promote` 才允许把草稿同步到 `plugins/<plugin-id>`。
3. `promote` 前必须通过完整校验链。

### 2.4 命令集（MVP）

通过插件 chat 命令执行：

1. `/p2p.init <plugin-id> --kind runtime_plugin|command_plugin`
   - 创建草稿骨架与元信息。
2. `/p2p.spec "<需求描述>"`
   - 生成或更新需求规格（写入 `.p2p-meta.json`）。
3. `/p2p.generate`
   - 根据规格生成 `plugin.json`、`src/runtime.ts`、README、示例命令。
4. `/p2p.validate`
   - 运行校验：清单字段、SDK 契约、构建、导出类检查、可加载检查。
5. `/p2p.test`
   - 运行最小联调脚本（至少 1 条成功 + 1 条失败分支）。
6. `/p2p.promote`
   - 校验全部通过后，将草稿发布到稳定目录。
7. `/p2p.rollback <revision>`
   - 把稳定目录回退到某个已记录版本。

### 2.5 状态机（草稿生命周期）

`draft` 状态建议：

1. `initialized`
2. `spec_ready`
3. `generated`
4. `validated`
5. `tested`
6. `promoted`
7. `rejected`

状态迁移约束：

- `generated -> validated` 必须先通过构建和入口校验。
- `validated -> tested` 必须通过清单与契约校验。
- `tested -> promoted` 必须达到最小测试门槛。
- 任一关键校验失败直接进入 `rejected`，不得 promote。

### 2.6 校验流水线（必须）

`/p2p.validate` 至少执行：

1. `plugin.json` 结构与字段语义校验（`id/kind/entry/capabilities/configSchema/defaultConfig`）。
2. 运行时契约校验（入口 `export default class`，`executeTurn` 返回形状）。
3. 构建校验（可编译为 ESM 产物）。
4. 加载校验（宿主隔离加载一次）。
5. 架构规则校验（如命中扫描范围则执行 `pnpm lint:arch`）。

`/p2p.test` 至少执行：

1. 正常请求回合（返回 `text`）。
2. 异常输入回合（有可读错误提示）。
3. 可选能力缺失分支（LLM/MCP 未注入场景不崩溃）。

### 2.7 与现有文档对齐

`Prompt2Plugin` 必须引用并内置当前文档规范：

- `packages/plugin-sdk/docs/插件开发文档.md`
- `packages/plugin-sdk/docs/插件开发检查清单.md`
- `packages/plugin-sdk/docs/command_plugin开发检查清单.md`
- `packages/plugin-sdk/docs/runtime_plugin开发检查清单.md`

要求：

1. 生成时自动注入“必做项”注释或 TODO。
2. 校验结果按清单条目输出通过/失败。
3. `promote` 前必须“关键项全绿”。

### 2.8 v1 验收标准（DoD）

1. 输入一句需求，可在 3 分钟内产出可加载草稿插件。
2. 草稿插件可通过 `validate + test` 最小链路。
3. 未通过校验的草稿无法 promote。
4. promote 后稳定目录插件可被宿主发现并正常执行一轮。
5. 整个过程可追踪（traceId、pluginId、draft revision、校验记录）。
