import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pPromoteArgs } from "../args/p2p-promote-args.js";
import type { P2pMeta } from "../entity/p2p-meta.js";
import { P2P_NEXT, P2P_STATUS } from "../constants.js";
import {
  appendPrompt2PluginAudit,
  copyDirectoryForPromote,
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  runSpawn,
  setPluginSdkDependencyToLocalFile,
  toNowIso
} from "../tools.js";

const promoteChains = new Map<string, Promise<unknown>>();

function enqueuePromote<T>(pluginId: string, task: () => Promise<T>): Promise<T> {
  const prev = promoteChains.get(pluginId) ?? Promise.resolve();
  const next = prev.then(() => task());
  promoteChains.set(pluginId, next.then(() => undefined, () => undefined));
  return next;
}

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

export type PromoteDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  pluginsRoot: string;
  params: P2pPromoteArgs;
};

/** `/p2p.promote`：快照当前 revision、将草稿复制到稳定目录；将 `package.json` 中 SDK 改为指向仓库的 `file:` 相对路径并在稳定目录执行 `pnpm install --ignore-workspace`（进程内单飞队列）。 */
export default class Promote {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly pluginsRoot: string;
  private readonly params: P2pPromoteArgs;

  constructor(deps: PromoteDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.pluginsRoot = deps.pluginsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    return enqueuePromote(this.params.pluginId.trim(), () => this.runInner());
  }

  private async runInner(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    this.ctx.emitToolRunning("p2p-promote", { pluginId });

    if (this.params.invalidExpectedRevision !== undefined) {
      this.ctx.emitToolError("p2p-promote", "expectedRevision 非法");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: `--expectedRevision 须为正整数，收到: ${this.params.invalidExpectedRevision}`
        }
      });
    }

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("p2p-promote", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const stablePath = path.join(this.pluginsRoot, pluginId);
    const meta = await readJsonSafe(metaPath);
    if (!meta || meta.pluginId !== pluginId) {
      this.ctx.emitToolError("p2p-promote", "未找到草稿");
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

    if (meta.status !== P2P_STATUS.tested) {
      this.ctx.emitToolError("p2p-promote", "状态须为 tested");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: String(meta.status || ""),
        nextAction: nextActionWithPluginId(P2P_NEXT.test, pluginId),
        error: {
          code: "P2P_E_PROMOTE_GATE",
          message: "请先完成 /p2p.test 使草稿 status 为 tested 后再 promote"
        }
      });
    }

    const currentRev = Number.isInteger(meta.revision) ? Number(meta.revision) : 1;
    if (this.params.expectedRevision !== undefined && this.params.expectedRevision !== currentRev) {
      this.ctx.emitToolError("p2p-promote", "revision 不一致");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: currentRev,
        status: P2P_STATUS.tested,
        nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
        error: {
          code: "P2P_E_PROMOTE_REVISION_MISMATCH",
          message: `expectedRevision=${this.params.expectedRevision} 与当前草稿 revision=${currentRev} 不一致`
        }
      });
    }

    const snapshotKey = String(currentRev);
    const snapshotDir = path.join(this.draftsRoot, "_snapshots", pluginId, snapshotKey);

    const now = toNowIso();
    try {
      await fs.mkdir(path.dirname(snapshotDir), { recursive: true });
      if (await pathExists(snapshotDir)) {
        await fs.rm(snapshotDir, { recursive: true, force: true });
      }
      await fs.mkdir(snapshotDir, { recursive: true });
      await copyDirectoryForPromote(draftPath, snapshotDir);

      if (await pathExists(stablePath)) {
        await fs.rm(stablePath, { recursive: true, force: true });
      }
      await fs.mkdir(stablePath, { recursive: true });
      await copyDirectoryForPromote(draftPath, stablePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.ctx.emitToolError("p2p-promote", msg);
      await appendPrompt2PluginAudit(this.draftsRoot, {
        traceId,
        pluginId,
        revision: currentRev,
        command: "/p2p.promote",
        status: "error",
        errorCode: "P2P_E_PROMOTE_IO"
      });
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: currentRev,
        status: P2P_STATUS.tested,
        nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
        error: { code: "P2P_E_PROMOTE_IO", message: msg }
      });
    }

    const pluginSdkAbs = path.resolve(this.pluginsRoot, "..", "packages", "plugin-sdk");
    let installErr: string | undefined;
    try {
      await setPluginSdkDependencyToLocalFile(snapshotDir, pluginSdkAbs);
      await setPluginSdkDependencyToLocalFile(stablePath, pluginSdkAbs);
      this.ctx.emitToolRunning("p2p-promote", { pluginId, phase: "pnpm-install", cwd: stablePath });
      const ir = await runSpawn(stablePath, "pnpm", ["install", "--ignore-workspace"], 300_000);
      if (!ir.ok) {
        installErr = (ir.stderr || ir.stdout || `exit ${String(ir.code)}`).slice(0, 2000);
      }
    } catch (e) {
      installErr = e instanceof Error ? e.message : String(e);
    }
    if (installErr !== undefined) {
      const msg = `稳定目录 pnpm install 失败：${installErr}`;
      this.ctx.emitToolError("p2p-promote", msg);
      await appendPrompt2PluginAudit(this.draftsRoot, {
        traceId,
        pluginId,
        revision: currentRev,
        command: "/p2p.promote",
        status: "error",
        errorCode: "P2P_E_PROMOTE_INSTALL",
        stablePath
      });
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: currentRev,
        status: P2P_STATUS.tested,
        nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
        error: { code: "P2P_E_PROMOTE_INSTALL", message: msg },
        data: { draftPath, stablePath, snapshotDir }
      });
    }

    const nextRevision = currentRev + 1;
    const lastPromote = { at: now, traceId, snapshotRevision: currentRev };
    const nextMeta: P2pMeta = {
      ...meta,
      status: P2P_STATUS.promoted,
      revision: nextRevision,
      lastPromote,
      updatedAt: now
    };
    await fs.writeFile(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");

    await appendPrompt2PluginAudit(this.draftsRoot, {
      traceId,
      pluginId,
      revision: nextRevision,
      command: "/p2p.promote",
      status: "ok",
      snapshotRevision: currentRev,
      stablePath
    });

    this.ctx.emitToolAvailable("p2p-promote", { pluginId, snapshotRevision: currentRev });
    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: nextRevision,
      status: P2P_STATUS.promoted,
      nextAction: nextActionWithPluginId(P2P_NEXT.status, pluginId),
      data: {
        draftPath,
        stablePath,
        snapshotDir,
        meta: nextMeta
      }
    });
  }
}
