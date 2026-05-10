import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pRollbackArgs } from "../args/p2p-rollback-args.js";
import { P2P_NEXT, P2P_STATUS, P2P_TARGET_KIND } from "../constants.js";
import {
  appendPrompt2PluginAudit,
  copyDirectoryForPromote,
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  toNowIso
} from "../tools.js";
import { validatePluginSpec } from "../lib/validate-plugin-spec.js";

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(jsonPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type RollbackDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  pluginsRoot: string;
  params: P2pRollbackArgs;
};

/** `/p2p.rollback`：从 `_snapshots/<plugin-id>/<revision>/` 恢复稳定目录，并对稳定 `plugin.json` 做快速清单校验。 */
export default class Rollback {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly pluginsRoot: string;
  private readonly params: P2pRollbackArgs;

  constructor(deps: RollbackDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.pluginsRoot = deps.pluginsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    this.ctx.emitToolRunning("p2p-rollback", { pluginId, revision: this.params.revision });

    if (this.params.invalidRevisionArg !== undefined) {
      this.ctx.emitToolError("p2p-rollback", "revision 非法");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.rollback, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: `revision 须为正整数，收到: ${this.params.invalidRevisionArg}`
        }
      });
    }

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("p2p-rollback", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.rollback, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }

    if (this.params.revision === undefined) {
      this.ctx.emitToolError("p2p-rollback", "缺少 revision");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.rollback, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: "请指定历史 revision，例如 /p2p.rollback my-plugin 5"
        }
      });
    }

    const rev = this.params.revision;
    const snapshotDir = path.join(this.draftsRoot, "_snapshots", pluginId, String(rev));
    if (!(await pathExists(snapshotDir))) {
      this.ctx.emitToolError("p2p-rollback", "快照不存在");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
        error: {
          code: "P2P_E_ROLLBACK_NOT_FOUND",
          message: `未找到 promote 快照: ${snapshotDir}（revision 须为某次成功 promote 时的草稿 revision）`
        }
      });
    }

    const stablePath = path.join(this.pluginsRoot, pluginId);
    const now = toNowIso();
    try {
      if (await pathExists(stablePath)) {
        await fs.rm(stablePath, { recursive: true, force: true });
      }
      await fs.mkdir(stablePath, { recursive: true });
      await copyDirectoryForPromote(snapshotDir, stablePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.ctx.emitToolError("p2p-rollback", msg);
      await appendPrompt2PluginAudit(this.draftsRoot, {
        traceId,
        pluginId,
        command: "/p2p.rollback",
        revision: rev,
        status: "error",
        errorCode: "P2P_E_ROLLBACK_IO"
      });
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.rollback, pluginId),
        error: { code: "P2P_E_ROLLBACK_IO", message: msg }
      });
    }

    const manifestPath = path.join(stablePath, "plugin.json");
    const manifestRaw = await readJsonSafe<Record<string, unknown>>(manifestPath);
    let quickValidateOk = false;
    let quickValidateDetail = "";
    if (!manifestRaw) {
      quickValidateDetail = "缺少 plugin.json";
    } else {
      const m = validatePluginSpec(manifestRaw);
      const kindOk = String(manifestRaw.kind ?? "") === P2P_TARGET_KIND;
      const idOk = String(manifestRaw.id ?? "") === pluginId;
      quickValidateOk = m.valid && kindOk && idOk;
      const parts: string[] = [];
      if (!m.valid) parts.push(m.errors.join("; "));
      if (!kindOk) parts.push(`kind 须为 ${P2P_TARGET_KIND}`);
      if (!idOk) parts.push("plugin.json.id 与目录名不一致");
      quickValidateDetail = quickValidateOk ? "ok" : parts.join(" | ");
    }

    this.ctx.emitToolAvailable("p2p-rollback", { pluginId, revision: rev, quickValidateOk });

    if (!quickValidateOk) {
      await appendPrompt2PluginAudit(this.draftsRoot, {
        traceId,
        pluginId,
        command: "/p2p.rollback",
        revision: rev,
        status: "validate_failed",
        quickValidateOk,
        stablePath
      });
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: rev,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
        data: {
          stablePath,
          snapshotDir,
          rolledBackToRevision: rev,
          quickValidate: { ok: quickValidateOk, detail: quickValidateDetail },
          updatedAt: now
        },
        error: {
          code: "P2P_E_ROLLBACK_VALIDATE",
          message: `文件已恢复，但快速校验未通过: ${quickValidateDetail}`
        }
      });
    }

    await appendPrompt2PluginAudit(this.draftsRoot, {
      traceId,
      pluginId,
      command: "/p2p.rollback",
      revision: rev,
      status: "ok",
      quickValidateOk,
      stablePath
    });

    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: rev,
      status: P2P_STATUS.promoted,
      nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
      data: {
        stablePath,
        snapshotDir,
        rolledBackToRevision: rev,
        quickValidate: { ok: quickValidateOk, detail: quickValidateDetail },
        updatedAt: now
      }
    });
  }
}
