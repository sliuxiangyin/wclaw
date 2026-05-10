import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pSpecArgs } from "../args/p2p-spec-args.js";
import type { P2pLlmService } from "../services/p2p-llm-service.js";
import { P2P_NEXT, P2P_STATUS } from "../constants.js";
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

function parseLlmSpecAugmentation(raw: string): {
  capabilities?: Record<string, unknown>;
  notes?: unknown[];
} | null {
  const t = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    const caps = o.capabilities;
    return {
      capabilities:
        caps && typeof caps === "object" && !Array.isArray(caps)
          ? { ...(caps as Record<string, unknown>) }
          : undefined,
      notes: Array.isArray(o.notes) ? o.notes : undefined
    };
  } catch {
    return null;
  }
}

export type SpecDeps = {
  ctx: TurnContextEmitter;
  /** 宿主会话 id，用于 LLM 多轮上下文文件隔离 */
  sessionId: string;
  draftsRoot: string;
  params: P2pSpecArgs;
  p2pLlm: P2pLlmService;
};

type SpecPrepareOk = {
  pluginId: string;
  draftPath: string;
  metaPath: string;
  meta: P2pMeta;
  capabilities: Record<string, unknown>;
  notes: unknown[];
};

/** `/p2p.spec`：写 `spec.rawPrompt`，可选经 LLM 补全 `capabilities`/`notes`，`status` → `spec_ready`。 */
export default class Spec {
  private readonly ctx: TurnContextEmitter;
  private readonly sessionId: string;
  private readonly draftsRoot: string;
  private readonly params: P2pSpecArgs;
  private readonly p2pLlm: P2pLlmService;

  constructor(deps: SpecDeps) {
    this.ctx = deps.ctx;
    this.sessionId = deps.sessionId;
    this.draftsRoot = deps.draftsRoot;
    this.params = deps.params;
    this.p2pLlm = deps.p2pLlm;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginIdPreview = this.params.pluginId.trim();
    this.ctx.emitToolRunning("spec-prepare", {
      pluginId: pluginIdPreview,
      textPreview: this.params.text.slice(0, 200)
    });

    const prepared = await this.prepareBeforeLlm(traceId);
    if (prepared.ok === false) {
      this.ctx.emitToolError("spec-prepare", prepared.result.text);
      return prepared.result
    };
    this.ctx.emitToolAvailable("spec-prepare", prepared);

    const { pluginId, draftPath, metaPath, meta, capabilities: baseCaps, notes: baseNotes } =
      prepared.data;
    const rawPrompt = this.params.text.trim();
    this.ctx.emitToolRunning("spec-llm", prepared.data);
    const augmented = await this.augmentWithLlm(traceId, rawPrompt, baseCaps, baseNotes);
    this.ctx.emitToolAvailable("spec-llm", augmented);
    return this.finalizeAfterLlm({
      traceId,
      pluginId,
      draftPath,
      metaPath,
      meta,
      rawPrompt,
      capabilities: augmented.capabilities,
      notes: augmented.notes,
      llmAugmented: augmented.llmAugmented
    });
  }

  /** LLM 之前：参数校验、定位草稿、读出 meta 与 spec 基线 */
  private async prepareBeforeLlm(
    traceId: string
  ): Promise<{ ok: true; data: SpecPrepareOk } | { ok: false; result: PluginTurnHandleResult }> {
    const pluginId = this.params.pluginId.trim();

    if (!pluginId || !isValidPluginId(pluginId)) {
      return {
        ok: false,
        result: p2pJsonTurn({
          ok: false,
          traceId,
          pluginId,
          status: P2P_STATUS.rejected,
          nextAction: nextActionWithPluginId(P2P_NEXT.spec, pluginId),
          error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
        })
      };
    }

    if (!this.params.text.trim()) {
      return {
        ok: false,
        result: p2pJsonTurn({
          ok: false,
          traceId,
          pluginId,
          status: P2P_STATUS.rejected,
          nextAction: nextActionWithPluginId(P2P_NEXT.spec, pluginId),
          error: { code: "P2P_E_INVALID_ARGS", message: "需求描述不能为空" }
        })
      };
    }

    const draftPath = path.join(this.draftsRoot, pluginId);
    const metaPath = path.join(draftPath, ".p2p-meta.json");
    const meta = await readJsonSafe(metaPath);

    if (!meta || meta.pluginId !== pluginId) {
      return {
        ok: false,
        result: p2pJsonTurn({
          ok: false,
          traceId,
          pluginId,
          status: P2P_STATUS.rejected,
          nextAction: nextActionWithPluginId(P2P_NEXT.initHint, pluginId),
          error: {
            code: "P2P_E_DRAFT_NOT_FOUND",
            message: "未找到草稿元数据，请先执行 /p2p.init"
          }
        })
      };
    }

    const prevSpec = meta.spec ?? {};
    const capabilities =
      prevSpec.capabilities &&
      typeof prevSpec.capabilities === "object" &&
      !Array.isArray(prevSpec.capabilities)
        ? { ...(prevSpec.capabilities as Record<string, unknown>) }
        : {};
    const notes = Array.isArray(prevSpec.notes) ? [...prevSpec.notes] : [];

    return {
      ok: true,
      data: { pluginId, draftPath, metaPath, meta, capabilities, notes }
    };
  }

  /** LLM：尝试补全 capabilities / notes；失败则保持入参不变 */
  private async augmentWithLlm(
    traceId: string,
    userText: string,
    capabilities: Record<string, unknown>,
    notes: unknown[]
  ): Promise<{ capabilities: Record<string, unknown>; notes: unknown[]; llmAugmented: boolean }> {
    let caps = capabilities;
    let n = notes;
    let llmAugmented = false;
    try {
      const tail = [
        {
          role: "system" as const,
          content:
            "你是 command_plugin 需求提炼助手。根据用户的插件需求描述，仅输出一个 JSON 对象（不要 markdown 围栏、不要其它文字），形如：\n" +
            '{"capabilities":{"brief":"一句话摘要"},"notes":["可选的补充要点"]}\n' +
            "capabilities 与 notes 均可按需省略键；未知信息不要编造。"
        },
        { role: "user" as const, content: userText }
      ];
      const llmText = await this.p2pLlm.spec(
        this.sessionId,
        { traceId, toolPolicy: "none", messages: tail },
        { exchangeUserText: userText }
      );
      const aug = parseLlmSpecAugmentation(llmText);
      if (aug?.capabilities && Object.keys(aug.capabilities).length > 0) {
        caps = { ...caps, ...aug.capabilities };
        llmAugmented = true;
      }
      if (aug?.notes && aug.notes.length > 0) {
        n = [...n, ...aug.notes];
        llmAugmented = true;
      }
    } catch {
      // LLM 不可用或解析失败：沿用基线
    }
    return { capabilities: caps, notes: n, llmAugmented };
  }

  /** LLM 之后：写 `.p2p-meta.json`、上报工具完成、返回 JSON 结果 */
  private async finalizeAfterLlm(input: {
    traceId: string;
    pluginId: string;
    draftPath: string;
    metaPath: string;
    meta: P2pMeta;
    rawPrompt: string;
    capabilities: Record<string, unknown>;
    notes: unknown[];
    llmAugmented: boolean;
  }): Promise<PluginTurnHandleResult> {
    const {
      traceId,
      pluginId,
      draftPath,
      metaPath,
      meta,
      rawPrompt,
      capabilities,
      notes,
      llmAugmented
    } = input;

    const nextRevision = Number.isInteger(meta.revision) ? Number(meta.revision) + 1 : 1;
    const now = toNowIso();

    const nextMeta: P2pMeta = {
      ...meta,
      pluginId,
      status: P2P_STATUS.spec_ready,
      revision: nextRevision,
      spec: {
        rawPrompt,
        capabilities,
        notes
      },
      updatedAt: now
    };

    await fs.writeFile(metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");
    return p2pJsonTurn({
      ok: true,
      traceId,
      pluginId,
      revision: nextRevision,
      status: P2P_STATUS.spec_ready,
      nextAction: nextActionWithPluginId(P2P_NEXT.generate, pluginId),
      data: {
        draftPath,
        meta: nextMeta,
        llmAugmented
      }
    });
  }
}
