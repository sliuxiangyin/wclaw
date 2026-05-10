import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pGenerateArgs } from "../args/p2p-generate-args.js";
import { P2P_NEXT, P2P_STATUS, P2P_TARGET_KIND, isAllowedCommandMode } from "../constants.js";
import type { P2pMeta } from "../entity/p2p-meta.js";
import {
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  toNowIso
} from "../tools.js";

async function readJsonSafe(jsonPath: string): Promise<P2pMeta | null> {
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    return JSON.parse(raw) as P2pMeta;
  } catch {
    return null;
  }
}

function pluginIdToRuntimeClassName(pluginId: string): string {
  const base = pluginId
    .split(/-+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join("");
  const safe = base.replace(/[^a-zA-Z0-9_]/g, "");
  return `${safe || "Draft"}Runtime`;
}

function pluginIdToDisplayName(pluginId: string): string {
  return pluginId
    .split(/-+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function buildRuntimeSource(className: string): string {
  return `import type {
  PluginRuntimeExtensionDeps,
  PluginSessionRow,
  PluginTurnContext,
  PluginTurnHandleResult
} from "@wclaw/plugin-sdk";
import { BasePluginRuntime, toSessionRow, toTurnResult } from "@wclaw/plugin-sdk";

export default class ${className} extends BasePluginRuntime {
  constructor(deps: PluginRuntimeExtensionDeps) {
    super(deps, { requiredBridges: [] });
  }

  decorateSessions(): PluginSessionRow[] {
    const sessionId = this.pluginId + ":default";
    return [
      toSessionRow({
        sessionId,
        title: this.pluginId + "（草稿）",
        ui: {
          subtitle: "command_plugin 占位",
          welcome: "发送任意文本将回显占位说明；请按需修改 src/runtime.ts。"
        },
        persistence: "persist",
        forceExecuteTurn: false
      })
    ];
  }

  async executeTurn(ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
    const msg = String(ctx.message ?? "").trim();
    if (!msg) {
      return toTurnResult("[" + this.pluginId + "] 草稿占位：请发送一条消息开始。");
    }
    return toTurnResult(
      "[" + this.pluginId + "] 草稿占位（可自行改 src/runtime.ts）：\\n\\n" + msg.slice(0, 4000)
    );
  }
}
`;
}

export type GenerateDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  params: P2pGenerateArgs;
};

/**
 * `/p2p.generate`：在草稿目录生成最小 command_plugin 骨架（须已为 spec_ready）。
 */
export default class Generate {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly params: P2pGenerateArgs;

  constructor(deps: GenerateDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    this.ctx.emitToolRunning("generate-bundle", {
      pluginId,
      templateVersion: this.params.templateVersion
    });

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("generate-bundle", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.generate, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }

    if (this.params.templateVersion !== "v1") {
      this.ctx.emitToolError("generate-bundle", "templateVersion 不支持");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.generate, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "templateVersion 当前仅支持 v1" }
      });
    }

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const meta = await readJsonSafe(metaPath);
    if (!meta || meta.pluginId !== pluginId) {
      this.ctx.emitToolError("generate-bundle", "未找到草稿");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
        error: {
          code: "P2P_E_DRAFT_NOT_FOUND",
          message: "未找到草稿元数据，请先执行 /p2p.init"
        }
      });
    }

    const rawPrompt = String(meta.spec?.rawPrompt ?? "").trim();
    if (meta.status !== P2P_STATUS.spec_ready) {
      this.ctx.emitToolError("generate-bundle", "状态须为 spec_ready");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: P2P_STATUS.rejected,
        nextAction:
          meta.status === P2P_STATUS.initialized
            ? nextActionWithPluginId(P2P_NEXT.spec, pluginId)
            : meta.status === P2P_STATUS.generated
              ? nextActionWithPluginId(P2P_NEXT.validate, pluginId)
              : nextActionWithPluginId(P2P_NEXT.status, pluginId),
        error: {
          code: "P2P_E_SPEC_MISSING",
          message: "请先执行 /p2p.spec 将草稿置为 spec_ready（且 rawPrompt 非空）后再 generate"
        }
      });
    }

    if (!rawPrompt) {
      this.ctx.emitToolError("generate-bundle", "rawPrompt 为空");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.spec, pluginId),
        error: { code: "P2P_E_SPEC_MISSING", message: "spec.rawPrompt 为空，请先补充 /p2p.spec" }
      });
    }

    const commandMode =
      meta.commandMode !== undefined && isAllowedCommandMode(String(meta.commandMode))
        ? String(meta.commandMode)
        : "ephemeral_with_context";
    const displayName = pluginIdToDisplayName(pluginId);
    const className = pluginIdToRuntimeClassName(pluginId);
    const systemPrompt = rawPrompt.slice(0, 12000);

    const pluginJson = {
      id: pluginId,
      displayName,
      version: "0.1.0",
      apiVersion: "v3",
      kind: "command_plugin",
      commandMode,
      entry: "dist/runtime.mjs",
      description: `（草稿）由 Prompt2Plugin Studio 从 spec 生成的占位插件：${pluginId}`,
      systemPrompt,
      configSchema: {
        type: "object",
        properties: {},
        additionalProperties: true
      },
      defaultConfig: {}
    };

    const packageJson = {
      name: `@wclaw/plugin-${pluginId}`,
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        deps: "pnpm install --ignore-workspace",
        build: "node ./node_modules/@wclaw/plugin-sdk/scripts/build-runtime.mjs",
        dev: "node ./node_modules/@wclaw/plugin-sdk/scripts/build-runtime.mjs --watch"
      },
      dependencies: {
        "@wclaw/plugin-sdk": "file:../../../packages/plugin-sdk"
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        typescript: "^5.0.0"
      }
    };

    const tsconfigJson = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        rootDir: "src",
        allowJs: true,
        checkJs: false,
        strict: false,
        skipLibCheck: true,
        types: ["node"],
        outDir: "dist"
      },
      include: ["src/**/*.ts"]
    };

    const readme = [
      `# ${pluginId}（草稿）`,
      ``,
      `由 \`prompt2plugin-studio\` 的 \`/p2p.generate\` 生成；请在 \`src/runtime.ts\` 中实现真实逻辑。`,
      ``,
      `目录约定见仓库 \`docs/Prompt2Plugin/Prompt2Plugin_v1_实施方案.md\` 第 3 节（\`src/\`、\`dist/\`、\`plugin.json\`）。`,
      ``,
      `依赖与构建：本草稿在 monorepo 目录树内但**不是**根 \`pnpm-workspace.yaml\` 的成员；在草稿目录请执行 \`pnpm run deps\`（等价 \`pnpm install --ignore-workspace\`），再执行 \`pnpm --ignore-workspace run build\`（或 \`pnpm run build\` 在已用 \`deps\` 装齐 \`node_modules\` 后通常也可）。**不要**只执行裸 \`pnpm install\`，否则会命中仓库根 workspace（终端出现 \`Scope: all N workspace projects\`）、本目录往往仍无独立 \`node_modules\`。本目录 \`.npmrc\` 含 \`ignore-workspace=true\` 仅作辅助，**不要**依赖仅靠它的裸 \`pnpm install\`。依赖 \`file:\` 指向仓库内 \`@wclaw/plugin-sdk\`。**勿用 \`npm install\` / \`npm i\` 替代 pnpm。**`,
      ``,
      `下一步：\`/p2p.validate ${pluginId}\`。`,
      ``
    ].join("\n");

    const files: Record<string, string> = {
      ".npmrc": "ignore-workspace=true\n",
      "plugin.json": `${JSON.stringify(pluginJson, null, 2)}\n`,
      "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
      "tsconfig.json": `${JSON.stringify(tsconfigJson, null, 2)}\n`,
      "src/runtime.ts": buildRuntimeSource(className),
      "README.md": readme
    };

    const nextRevision = Number.isInteger(meta.revision) ? Number(meta.revision) + 1 : 1;
    const now = toNowIso();

    try {
      await fs.mkdir(draftPath, { recursive: true });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(draftPath, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf-8");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.ctx.emitToolError("generate-bundle", message);
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.generate, pluginId),
        error: { code: "P2P_E_GENERATE_FAILED", message }
      });
    }

    const nextMeta: P2pMeta = {
      ...meta,
      kind: P2P_TARGET_KIND,
      status: P2P_STATUS.generated,
      revision: nextRevision,
      updatedAt: now
    };
    await fs.writeFile(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");

    this.ctx.emitToolAvailable("generate-bundle", {
      pluginId,
      generatedFiles: Object.keys(files),
      revision: nextRevision
    });

    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: nextRevision,
      status: P2P_STATUS.generated,
      nextAction: nextActionWithPluginId(P2P_NEXT.validate, pluginId),
      data: {
        draftPath,
        templateVersion: this.params.templateVersion,
        generatedFiles: Object.keys(files),
        meta: nextMeta
      }
    });
  }
}
