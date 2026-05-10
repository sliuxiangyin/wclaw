# demo-plugin（草稿）

由 `prompt2plugin-studio` 的 `/p2p.generate` 生成；请在 `src/runtime.ts` 中实现真实逻辑。

目录约定见仓库 `docs/Prompt2Plugin/Prompt2Plugin_v1_实施方案.md` §3（`src/`、`dist/`、`plugin.json`）。

构建：在草稿目录执行 `pnpm install` 后 `pnpm run build`（依赖通过 `file:` 指向仓库内 `@wclaw/plugin-sdk`）。

下一步：`/p2p.validate demo-plugin`。
