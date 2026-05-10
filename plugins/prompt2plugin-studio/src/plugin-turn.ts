import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult } from "@wclaw/plugin-sdk";

import { toTurnResult, TurnContextEmitter } from "@wclaw/plugin-sdk";
import { P2pInitArgs } from "./args/p2p-init-args.js";
import { P2pGenerateArgs } from "./args/p2p-generate-args.js";
import {
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  toNowIso
} from "./tools.js";
import { P2P_NEXT, P2P_STATUS, P2P_TARGET_KIND, isAllowedCommandMode } from "./constants.js";
import { P2pSpecArgs } from "./args/p2p-spec-args.js";
import Generate from "./handler/generate.js";
import Validate from "./handler/validate.js";
import Status from "./handler/status.js";
import Spec from "./handler/spec.js";
import type { P2pLlmService } from "./services/p2p-llm-service.js";
import Test from "./handler/test.js";
import Promote from "./handler/promote.js";
import Rollback from "./handler/rollback.js";
import type { P2pMeta } from "./entity/p2p-meta.js";
import { checkPathNodeForBuild } from "./build-prereq.js";
import type { P2pValidateArgs } from "./args/p2p-validate-args.js";
import type { P2pStatusArgs } from "./args/p2p-status-args.js";
import type { P2pTestArgs } from "./args/p2p-test-args.js";
import type { P2pPromoteArgs } from "./args/p2p-promote-args.js";
import type { P2pRollbackArgs } from "./args/p2p-rollback-args.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(jsonPath: string): Promise<P2pMeta | null> {
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    return JSON.parse(raw) as P2pMeta;
  } catch {
    return null;
  }
}

export default class PluginTurnHandler {
  private ctx: TurnContextEmitter ;
  private readonly pluginId: string;
  private readonly pluginDir: string;
  private readonly pluginsRoot: string;
  private readonly draftsRoot: string;
  private readonly p2pLlm: P2pLlmService;
  constructor(
    ctx: TurnContextEmitter,
    deps: {
      pluginId: string;
      pluginDir: string;
      pluginsRoot: string;
      draftsRoot: string;
      p2pLlm: P2pLlmService;
    }
  ) {
    this.ctx = ctx;
    this.pluginId = deps.pluginId;
    this.pluginDir = deps.pluginDir;
    this.pluginsRoot = deps.pluginsRoot;
    this.draftsRoot = deps.draftsRoot;
    this.p2pLlm = deps.p2pLlm;
  }

  /** @param init 由 `/p2p.init <plugin-id> [--commandMode …]` 解析得到 */
  async init(params: P2pInitArgs): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    this.ctx.emitToolRunning("create-draft",{
      pluginId: params.pluginName.trim(),
      commandMode: params.commandMode ?? null
    });

    const pluginId = params.pluginName.trim();

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("create-draft", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }
    if (params.commandMode !== undefined && !isAllowedCommandMode(params.commandMode)) {
      this.ctx.emitToolError("create-draft", "commandMode 须为 ephemeral_with_context | ephemeral_no_context | isolated_chat 之一，或省略");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message:
            "commandMode 须为 ephemeral_with_context | ephemeral_no_context | isolated_chat 之一，或省略"
        }
      });
    }

    const kindFromConfig = String(this.ctx.context.config?.defaultKind ?? "").trim();
    const kind = kindFromConfig || P2P_TARGET_KIND;
    if (kind !== "command_plugin") {
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: "本 Studio 仅生成 command_plugin；请在宿主配置中将 defaultKind 设为 command_plugin"
        }
      });
    }

    const nodeProbe = await checkPathNodeForBuild();
    if (nodeProbe.ok === false) {
      this.ctx.emitToolError("create-draft", nodeProbe.message);
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
        error: { code: nodeProbe.code, message: nodeProbe.message }
      });
    }
    const pathNodeVersion = nodeProbe.version;

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const stablePath = path.join(this.pluginsRoot, pluginId);

    const stableExists = await pathExists(stablePath);

    if (stableExists) {
      this.ctx.emitToolError("create-draft", "插件已存在");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: null,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
        error: { code: "P2P_E_STABLE_EXISTS", message: "稳定目录已存在同名插件，无法创建草稿" }
      });
    }

    //存在插件草稿 返回插件草稿信息
    const existingMeta = await readJsonSafe(metaPath);
    if (existingMeta?.pluginId === pluginId) {
      this.ctx.emitToolAvailable("create-draft", {
        meta: existingMeta,
        preview: `插件草稿已存在（详见 meta）`
      });
      const rev = Number.isInteger(existingMeta.revision) ? Number(existingMeta.revision) : 1;
      const st = String(existingMeta.status || P2P_STATUS.initialized);
      return p2pJsonTurn({
        ok: true,
        traceId,
        pluginId,
        revision: rev,
        status: st,
        nextAction: nextActionWithPluginId(P2P_NEXT.spec, pluginId),
        data: {
          draftPath,
          duplicate: true,
          meta: existingMeta,
          pathNodeVersion
        }
      });
    }

    await fs.mkdir(draftPath, { recursive: true });
    const now = toNowIso();
    const meta: P2pMeta = {
      pluginId,
      kind,
      ...(params.commandMode !== undefined ? { commandMode: params.commandMode } : {}),
      status: P2P_STATUS.initialized,
      revision: 1,
      spec: {
        rawPrompt: "",
        capabilities: {},
        notes: []
      },
      lastValidation: null,
      lastTest: null,
      updatedAt: now
    };

    await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
    // emitToolAvailable(toolName, output) 仅两参数；勿传第三个参数（会被忽略）。此前第二个参数写 {} 导致 SSE 里 output 恒为空对象。
    this.ctx.emitToolAvailable("create-draft", { meta, pathNodeVersion });
    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: 1,
      status: P2P_STATUS.initialized,
      nextAction: nextActionWithPluginId(P2P_NEXT.spec, pluginId),
      data: {
        draftPath,
        meta,
        pathNodeVersion
      }
    });
  }


  /** `/p2p.spec`：委托 `Spec` handler（`P2pLlmService`：宿主 LLM + 会话上下文）。 */
  async spec(params: P2pSpecArgs): Promise<PluginTurnHandleResult> {
    return new Spec({
      ctx: this.ctx,
      sessionId: this.ctx.context.sessionId,
      draftsRoot: this.draftsRoot,
      params,
      p2pLlm: this.p2pLlm
    }).run();
  }

  /** `/p2p.generate`：委托 `Generate` handler。 */
  async generate(params: P2pGenerateArgs): Promise<PluginTurnHandleResult> {
    return new Generate({ ctx: this.ctx, draftsRoot: this.draftsRoot, params }).run();
  }

  /** `/p2p.validate`：委托 `Validate` handler。 */
  async validate(params: P2pValidateArgs): Promise<PluginTurnHandleResult> {
    return new Validate({ ctx: this.ctx, draftsRoot: this.draftsRoot, params }).run();
  }

  /** `/p2p.status`：委托 `Status` handler。 */
  async status(params: P2pStatusArgs): Promise<PluginTurnHandleResult> {
    return new Status({
      ctx: this.ctx,
      draftsRoot: this.draftsRoot,
      pluginsRoot: this.pluginsRoot,
      params
    }).run();
  }

  /** `/p2p.test`：委托 `Test` handler。 */
  async test(params: P2pTestArgs): Promise<PluginTurnHandleResult> {
    return new Test({ ctx: this.ctx, draftsRoot: this.draftsRoot, params }).run();
  }

  /** `/p2p.promote`：委托 `Promote` handler。 */
  async promote(params: P2pPromoteArgs): Promise<PluginTurnHandleResult> {
    return new Promote({
      ctx: this.ctx,
      draftsRoot: this.draftsRoot,
      pluginsRoot: this.pluginsRoot,
      params
    }).run();
  }

  /** `/p2p.rollback`：委托 `Rollback` handler。 */
  async rollback(params: P2pRollbackArgs): Promise<PluginTurnHandleResult> {
    return new Rollback({
      ctx: this.ctx,
      draftsRoot: this.draftsRoot,
      pluginsRoot: this.pluginsRoot,
      params
    }).run();
  }

  async updateDraft(): Promise<PluginTurnHandleResult> {
    return toTurnResult("请选择一个选项：");
  }
}
