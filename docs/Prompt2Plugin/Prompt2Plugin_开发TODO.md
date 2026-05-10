# Prompt2Plugin / prompt2plugin-studio 开发 TODO

更新时间：2026-05-10  

本清单聚焦 **`prompt2plugin-studio` + v1 流水线** 的可执行任务；与仓库根目录 `docs/进度/任务TODO.md`（宿主全栈）互补，不重复罗列宿主基建项。

关联文档：

- [Prompt2Plugin_v1_实施方案.md](./Prompt2Plugin_v1_实施方案.md)（§11 五日拆分、§12 DoD）
- [Prompt2Plugin_开发目标.md](./Prompt2Plugin_开发目标.md)
- `packages/plugin-sdk/docs/command_plugin开发检查清单.md`（生成物校验主清单）

标记：`[ ]` 待办 / `[~]` 进行中 / `[x]` 已完成  

---

## 现状快照（便于对齐认领）

| 能力 | 代码侧概况 |
|------|------------|
| 插件装载 | `plugins/prompt2plugin-studio` 已实现，`plugin.json` 为 **`runtime_plugin`**（控制台编排 + `forceExecuteTurn` 可走每条消息 `executeTurn`） |
| `/p2p.status` | `runtime.ts` 中 `handleStatus` 已实现，读 `.drafts/<id>/.p2p-meta.json` |
| `/p2p.init` | `parseP2pInitArgs` 已解析 **`pluginName` + `--commandMode`**；`createDraft` 仍为占位，**未**接上既有 `handleInit`（写入 meta）；文档口径已改为 **`--commandMode`**，源码内仍有 **`--kind`**、占位 UI、调试 `console.log` 待收敛 |

---

## P0：协议与入口对齐（先做）

- [ ] **`/p2p.init` 与文档一致**：实现草稿创建时写入目标草稿未来的 **`commandMode`**（至 `.p2p-meta.json` 或生成期再用）；错误文案、`nextAction`、`decorateSessions.suggestions` 全部改为 `--commandMode`，移除或仅兼容废弃 `--kind`
- [ ] **`createDraft` 接入真实逻辑**：合并/委托现有 `handleInit`，写入 `.drafts/<plugin-id>/`、revision、结构化 `buildResult`
- [ ] **移除或降级调试代码**：`executeTurn` / `executeCompleted` 内 `console.log`、未实现的 `parsed.command.includes("/p2p.")` 分支（要么删要么定义「走 LLM」产品规则）
- [ ] **`plugin-turn.ts`**：`createDraft` 落盘后返回真实 JSON 结果，删除占位「请选择一个选项」——除非产品刻意保留多步向导

---

## P1：v1 命令闭环（按实施方案 §4）

- [ ] **`/p2p.spec "<需求描述>"`**：持久化 `spec.rawPrompt`（及约束字段），更新 `.p2p-meta.json` 状态 → `spec_ready`
- [ ] **`/p2p.generate`**：自模板生成 `plugin.json` / `src` / `README` 等（**目标 `kind` 恒为 `command_plugin`**），revision 自增与变更摘要
- [ ] **`/p2p.validate`**：清单 + SDK 契约 + 可选子进程 `tsc` / `lint:arch`；统一校验报告结构（与 `P2P_E_*` 对齐）
- [ ] **`/p2p.test`**：最小冒烟（加载、`executeTurn` 或约定脚本）；失败写 meta / 审计
- [ ] **`/p2p.promote` / `/p2p.rollback`**：晋升至 `plugins/<plugin-id>/`、revision 门禁、回滚策略（实施方案 §8–9）

---

## P2：治理与运维（实施方案 §9–11.1）

- [ ] **审计日志**：每次 `/p2p.*` 追加结构化记录（路径建议见实施方案 §9）
- [ ] **草稿与工作区配额**：`maxDraftRevisions`、`maxWorkspaceSizeMb`、归档策略；`/p2p.status` 输出占用与最近清理时间（§11.1）
- [ ] **并发**：`promote` 使用 `expectedRevision` 防覆盖（实施方案 §4.1）

---

## P3：文档与验收（§12 DoD）

- [ ] **专题 README / 开发目标**：Studio 自身 **`runtime_plugin`** 与**生成目标 `command_plugin`** 表述一致（避免读者误认为 Studio 仍是 command_plugin）
- [ ] **操作手册**：端到端截图或命令序列（init → spec → generate → validate → test → promote）
- [ ] **DoD 自测**：两条不同业务场景的草稿跑通全链路；校验失败时 promote 拒绝且原因可定位

---

## 附录：与「五日拆分」映射（实施方案 §11）

| 阶段 | 对应本节 |
|------|----------|
| Day 1 骨架与 init/status | **P0** + `.p2p-meta.json` 读写收口 |
| Day 2 生成器 | **P1** 中 spec / generate |
| Day 3 校验器 | **P1** validate |
| Day 4 测试与晋升 | **P1** test / promote / rollback |
| Day 5 联调与文档 | **P3** |

维护约定：完成条目后把 `[ ]` 改为 `[x]`，并在 `Prompt2Plugin_v1_实施方案.md` 或 `功能清单_status.md`（若纳入宿主台账）中同步一句状态，避免双份漂移。
