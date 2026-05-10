import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  PluginHostPublishInput,
  PluginRuntimeExtensionDeps,
  PluginTurnHandleResult,
  TurnContextEmitter
} from "@wclaw/plugin-sdk";

import type { P2pTestArgs } from "../args/p2p-test-args.js";
import type { P2pMeta } from "../entity/p2p-meta.js";
import { P2P_NEXT, P2P_STATUS } from "../constants.js";
import {
  appendPrompt2PluginAudit,
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  toNowIso
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

async function readManifestEntry(draftPath: string): Promise<string> {
  const manifestPath = path.join(draftPath, "plugin.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const j = JSON.parse(raw) as { entry?: string };
    return String(j?.entry ?? "dist/runtime.mjs").trim() || "dist/runtime.mjs";
  } catch {
    return "dist/runtime.mjs";
  }
}

function noopPublish(_input: PluginHostPublishInput): void {
  /* Studio 探测性实例化，不落 Hub */
}

export type TestDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  params: P2pTestArgs;
};

/** `/p2p.test`：动态 import 草稿入口并对 `executeTurn` 做最小断言。 */
export default class Test {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly params: P2pTestArgs;

  constructor(deps: TestDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    this.ctx.emitToolRunning("p2p-test", { pluginId, suite: this.params.suite });

    if (this.params.invalidSuiteArg !== undefined) {
      this.ctx.emitToolError("p2p-test", "suite 非法");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.test, pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: `--suite 须为 smoke 或 full，收到: ${this.params.invalidSuiteArg}`
        }
      });
    }

    if (!pluginId || !isValidPluginId(pluginId)) {
      this.ctx.emitToolError("p2p-test", "pluginId 非法或缺失");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.test, pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const meta = await readJsonSafe(metaPath);
    if (!meta || meta.pluginId !== pluginId) {
      this.ctx.emitToolError("p2p-test", "未找到草稿");
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

    if (meta.status !== P2P_STATUS.validated) {
      this.ctx.emitToolError("p2p-test", "状态须为 validated");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: String(meta.status || ""),
        nextAction: nextActionWithPluginId(P2P_NEXT.validate, pluginId),
        error: {
          code: "P2P_E_TEST_GATE",
          message: "请先完成 /p2p.validate 使草稿 status 为 validated 后再 test"
        }
      });
    }

    const entryRel = await readManifestEntry(draftPath);
    const entryAbs = path.join(draftPath, ...entryRel.split("/").filter(Boolean));
    if (!(await pathExists(entryAbs))) {
      this.ctx.emitToolError("p2p-test", "缺少构建产物入口");
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: Number.isInteger(meta.revision) ? Number(meta.revision) : null,
        status: P2P_STATUS.validated,
        nextAction: nextActionWithPluginId(P2P_NEXT.validate, pluginId),
        error: {
          code: "P2P_E_TEST_NO_ENTRY",
          message: `未找到入口文件 ${entryRel}；请先执行 /p2p.validate --profile full（含 pnpm run build）或在草稿目录内构建`
        }
      });
    }

    let lastErr: string | undefined;
    try {
      const href = pathToFileURL(entryAbs).href;
      const mod = (await import(href)) as { default?: new (d: PluginRuntimeExtensionDeps) => { executeTurn?: (c: unknown) => Promise<unknown> } };
      const Cls = mod?.default;
      if (typeof Cls !== "function") {
        throw new Error("入口 default 非可构造类");
      }
      const deps: PluginRuntimeExtensionDeps = {
        pluginId,
        publish: noopPublish,
        workspaceDir: draftPath
      };
      const inst = new Cls(deps);
      if (typeof inst.executeTurn !== "function") {
        throw new Error("实例缺少 executeTurn");
      }

      const assertText = (label: string, r: unknown): string => {
        if (!r || typeof r !== "object" || !("text" in r)) {
          throw new Error(`${label}: 返回值须为含 text 的对象`);
        }
        const text = String((r as { text?: unknown }).text ?? "");
        if (!text.trim()) {
          throw new Error(`${label}: text 为空`);
        }
        return text;
      };

      const r1 = await inst.executeTurn({
        sessionId: "p2p-test-smoke",
        message: "hello",
        config: {}
      });
      assertText("turn-normal", r1);

      const r2 = await inst.executeTurn({
        sessionId: "p2p-test-smoke",
        message: "\n\t\x00 weird",
        config: {}
      });
      assertText("turn-weird", r2);

      if (this.params.suite === "full") {
        const r3 = await inst.executeTurn({
          sessionId: "p2p-test-full",
          message: "",
          config: {}
        });
        assertText("turn-empty", r3);
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }

    const now = toNowIso();
    const nextRevision = Number.isInteger(meta.revision) ? Number(meta.revision) + 1 : 1;
    const lastTest = {
      suite: this.params.suite,
      at: now,
      ok: lastErr === undefined,
      detail: lastErr
    };

    const nextMeta: P2pMeta = {
      ...meta,
      revision: nextRevision,
      lastTest,
      updatedAt: now,
      ...(lastErr === undefined ? { status: P2P_STATUS.tested } : {})
    };
    await fs.writeFile(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");

    await appendPrompt2PluginAudit(this.draftsRoot, {
      traceId,
      pluginId,
      revision: nextRevision,
      command: "/p2p.test",
      status: lastErr === undefined ? "ok" : "error",
      errorCode: lastErr === undefined ? null : "P2P_E_TEST_FAILED"
    });

    if (lastErr !== undefined) {
      this.ctx.emitToolError("p2p-test", lastErr);
      return p2pJsonTurn({
        ok: false,
        traceId,
        pluginId,
        revision: nextRevision,
        status: P2P_STATUS.validated,
        nextAction: nextActionWithPluginId(P2P_NEXT.test, pluginId),
        data: { draftPath, lastTest, meta: nextMeta },
        error: { code: "P2P_E_TEST_FAILED", message: lastErr }
      });
    }

    this.ctx.emitToolAvailable("p2p-test", { pluginId, suite: this.params.suite });
    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: nextRevision,
      status: P2P_STATUS.tested,
      nextAction: nextActionWithPluginId(P2P_NEXT.promote, pluginId),
      data: { draftPath, lastTest, meta: nextMeta }
    });
  }
}
