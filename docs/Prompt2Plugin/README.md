# Prompt2Plugin 专题存档

本目录汇总 **Prompt2Plugin**（插件能力从对话探索到可治理落地的进化与 v1 流水线）的开发目标与配套文档。

| 文档 | 说明 |
|------|------|
| [Prompt2Plugin_开发目标.md](./Prompt2Plugin_开发目标.md) | 进化引擎愿景、护栏、降级与 v1 目标、组件、命令、校验与 DoD |
| [Prompt2Plugin_v1_实施方案.md](./Prompt2Plugin_v1_实施方案.md) | v1 执行稿：目录、`/p2p.*` 协议、流水线、任务拆分 |
| [Prompt2Plugin_通用提示词规范_v1.md](./Prompt2Plugin_通用提示词规范_v1.md) | 任务分析 / 启动 / 修复 / 收敛等提示词与 JSON 契约 |

项目总览中与 Prompt2Plugin 相关的摘要仍可从 [项目蓝图](../项目蓝图.md) 的「Prompt2Plugin」小节跳转到此处。

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
