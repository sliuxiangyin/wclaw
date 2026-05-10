import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pStatusArgs } from "../args/p2p-status-args.js";
import type { P2pMeta } from "../entity/p2p-meta.js";
import { P2P_NEXT, P2P_STATUS } from "../constants.js";
import {
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn
} from "../tools.js";

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

export type StatusDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  pluginsRoot: string;
  params: P2pStatusArgs;
};

/** `/p2p.status`：读取 `.p2p-meta.json` 与稳定目录存在性，给出 `nextAction`。 */
export default class Status {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly pluginsRoot: string;
  private readonly params: P2pStatusArgs;

  constructor(deps: StatusDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.pluginsRoot = deps.pluginsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    this.ctx.emitToolRunning("p2p-status", { pluginId });

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("p2p-status", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const stablePath = path.join(this.pluginsRoot, pluginId);

    const meta = await readJsonSafe(metaPath);
    if (!meta) {
      this.ctx.emitToolError("p2p-status", "未找到草稿");
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

    const st = String(meta.status || P2P_STATUS.initialized);
    const nextAction =
      st === P2P_STATUS.initialized
        ? nextActionWithPluginId(P2P_NEXT.spec, pluginId)
        : st === P2P_STATUS.spec_ready
          ? nextActionWithPluginId(P2P_NEXT.generate, pluginId)
          : st === P2P_STATUS.generated
            ? nextActionWithPluginId(P2P_NEXT.validate, pluginId)
            : st === P2P_STATUS.validated
              ? nextActionWithPluginId(P2P_NEXT.test, pluginId)
              : st === P2P_STATUS.tested
                ? nextActionWithPluginId(P2P_NEXT.promote, pluginId)
                : st === P2P_STATUS.promoted
                  ? nextActionWithPluginId(P2P_NEXT.status, pluginId)
                  : nextActionWithPluginId(P2P_NEXT.status, pluginId);
    this.ctx.emitToolAvailable("p2p-status", { pluginId, status: st });
    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
      status: st,
      nextAction,
      data: {
        kind: String(meta.kind || ""),
        commandMode: meta.commandMode ? String(meta.commandMode) : "",
        draftPath,
        stableExists: await pathExists(stablePath),
        updatedAt: String(meta.updatedAt || "")
      }
    });
  }
}
