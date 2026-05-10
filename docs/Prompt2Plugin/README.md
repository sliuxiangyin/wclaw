# Prompt2Plugin 专题存档

本目录汇总 **Prompt2Plugin**（插件能力从对话探索到可治理落地的进化与 v1 流水线）的开发目标与配套文档。

| 文档 | 说明 |
|------|------|
| [Prompt2Plugin_开发目标.md](./Prompt2Plugin_开发目标.md) | 进化引擎愿景、护栏、降级与 v1 目标、组件、命令、校验与 DoD |
| [Prompt2Plugin_v1_实施方案.md](./Prompt2Plugin_v1_实施方案.md) | v1 执行稿：目录、`/p2p.*` 协议、流水线、任务拆分 |
| [Prompt2Plugin_开发TODO.md](./Prompt2Plugin_开发TODO.md) | **开发执行清单**（与 §11 五日拆分映射；含现状快照与优先级） |
| [Prompt2Plugin_LLM与提示词链_实现TODO.md](./Prompt2Plugin_LLM与提示词链_实现TODO.md) | **LLM 接入 + 通用提示词 A–E / §9 日志** 实现清单（建议 v1.1） |
| [Prompt2Plugin_通用提示词规范_v1.md](./Prompt2Plugin_通用提示词规范_v1.md) | 任务分析 / 启动 / 修复 / 收敛等提示词与 JSON 契约 |

项目总览中与 Prompt2Plugin 相关的摘要仍可从 [项目蓝图](../项目蓝图.md) 的「Prompt2Plugin」小节跳转到此处。

---

## 快速开工入口（2 分钟）

推荐阅读顺序（先原则，后细节）：

1. [Prompt2Plugin_开发目标.md](./Prompt2Plugin_开发目标.md)
  - 看清目标边界、v1 命令范围、DoD 与治理底线。
2. [Prompt2Plugin_v1_实施方案.md](./Prompt2Plugin_v1_实施方案.md)
  - 按章节执行：命令契约 -> 生成 -> 校验 -> 测试 -> promote/rollback。
3. [Prompt2Plugin_通用提示词规范_v1.md](./Prompt2Plugin_通用提示词规范_v1.md)
  - 用于 `v1.1` 的提示词执行链（analysis/run/repair/converge/script）。

---

## v1 实施顺序（建议）

按以下顺序推进可减少返工：

1. 先定协议：完成 `/p2p.*` 输入/输出契约与错误码。
2. 再搭骨架：打通 `init/spec/status` 与 `.p2p-meta.json` 读写。
3. 再做生成：完成 `generate` 的模板产物与 revision 规则。
4. 再做门禁：接入 `validate/test` 隔离执行链。
5. 最后发布：实现 `promote/rollback`、并发锁与审计记录。

注意：

- `v1` 只交付：`init/spec/generate/validate/test/promote/rollback/status`。
- `generate-prompts/run/repair/converge/generate-script` 归 `v1.1`。
- **`/p2p.init` 统一写法**：`/p2p.init <plugin-id> [--commandMode ephemeral_with_context|ephemeral_no_context|isolated_chat]`；选填 `--commandMode` 写入**目标草稿**清单；生成目标 `plugin.json.kind` 恒为 `command_plugin`（详见实施方案 §4）。
- **`prompt2plugin-studio` v1 只生成目标插件类型 `command_plugin`**（`plugin.json.kind`），不生成 `runtime_extension`；Studio 自身宿主清单可与目标类型不同（例如 `runtime_plugin` 以便控制台编排）；多会话、`decorateSessions` 等由 Studio 实现。

---

## 开工前检查清单（必看）

1. 命令契约是否已写成可机读结构（不是纯文本约定）。
2. 权限矩阵是否明确（最小权限 + 越权边界）。
3. `validate/test` 是否使用隔离目录与沙箱加载。
4. `promote` 是否具备并发门禁（锁 + `expectedRevision`）。
5. 审计与保留策略是否落地（命令日志 + promote/rollback 对照）。
6. 草稿与工作区是否有清理配额（防目录长期膨胀）。

---

## 目录职责示意图（插件侧 vs 宿主侧）

以下为**职责分界**示意，不要求目录名与未来实现一字不差；只要「写什么、谁读谁、为何不混放」一口径一致。

```txt
插件仓库源码树（可被扫描的稳定包 + 隔离草稿）
├── plugins/<plugin-id>/              # 【稳定】宿主启动时发现的正式插件目录
├── plugins/.drafts/<plugin-id>/      # 【草稿】generate / validate / test 只允许写这里
└── plugins/prompt2plugin-studio/     # 【开发插件】下发 /p2p.* 与读写草稿、触发校验链

宿主进程工作区（运行时状态，≠ 源码树）
└── （host-api cwd）var/plugin-workspaces/<plugin-id>/
                                   # 【工作区】落盘缓存、抓取结果、运行时产物；不入 promote 的包体

校验 / 沙箱（多为临时）
└── （临时目录或由 CI/子进程挂载）       # 【校验临时】隔离 import()、冒烟脚本；失败即丢弃，不写稳定目录
```

| 层级 | 典型路径约定 | 谁写 | 谁读 | 注意 |
|------|----------------|------|------|------|
| 稳定插件 | `plugins/<plugin-id>/` | promote | 宿主加载器 | 不得被生成器原地覆盖 |
| 草稿 | `plugins/.drafts/<plugin-id>/` | `/p2p.*` | 校验、studio | revision 真相在 `.p2p-meta.json` 等 |
| 工作区 | `var/plugin-workspaces/<plugin-id>/`（相对 host-api cwd） | 运行时插件逻辑 | 同插件 | 与 `plugins/` 解耦；晋升可不拷此树 |
| 校验临时 | `/tmp/`、CI workspace 等 | 校验器 | 一次性进程 | 不替代草稿；仅存「当次校验」 |

详见 [Prompt2Plugin_v1_实施方案.md §3](./Prompt2Plugin_v1_实施方案.md) 的补充说明。

---

## 版本线与 `decorateSessions`：减上下文入口（产品口径）

目标是：**流程跑通后仍可不断开新版本**，同时避免所有历史挤在同一对话上下文中。

- **真相源**：仍以 `.p2p-meta.json` 中的 `revision`、promote / 校验记录等为权威；会话里的文字只是复述，不能替代持久化 meta。
- **列表层入口**：建议 `prompt2plugin-studio` 使用 **`sessionProvider.mode=multi`**，在 **`decorateSessions`** 中为「当前关注的每个 `<plugin-id> + revision`（或等价版本线标识）」返回一行 **会话列表展示**：标题写明插件与 revision／状态／摘要，等价于仓库里「**按版本维护说明文档**」（例如类比根目录 AGENTS/README 的版本化收口）——**读列表即知道有哪几条线在跑**，不必在一串消息里翻来翻去。
- **会话**：用户点开某一行，即进入对应 **narrow 上下文**的一条 Host 会话；新开的版本线可走新会话，旧线只读可查，从而减少单 thread 体量。

契约上：**`decorateSessions` 只做列表塑形与引导**，不写业务持久化逻辑；.revision 与健康状态仍应从 meta／宿主侧数据源读取后在 UI 层展示。
