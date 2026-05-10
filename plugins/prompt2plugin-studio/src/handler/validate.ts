import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginTurnHandleResult, TurnContextEmitter } from "@wclaw/plugin-sdk";

import type { P2pValidateArgs } from "../args/p2p-validate-args.js";
import type { P2pMeta } from "../entity/p2p-meta.js";
import { P2P_NEXT, P2P_STATUS, P2P_TARGET_KIND } from "../constants.js";
import {
  createTraceId,
  isValidPluginId,
  nextActionWithPluginId,
  p2pJsonTurn,
  runSpawn,
  toNowIso
} from "../tools.js";
import { validatePluginSpec } from "../lib/validate-plugin-spec.js";

/** 静态阶段（参数 / meta / 清单 / 源码契约）——短时，单独 toolName */
const VALIDATE_TOOL_STATIC = "p2p-validate-static";
/** 耗时阶段（pnpm install + build、入口 import、落库）——单独 toolName */
const VALIDATE_TOOL_BUILD = "p2p-validate-build";

/** 从 `p2pJsonTurn` 返回的 `PluginTurnHandleResult.text` 中解析 JSON 体 */
function p2pTurnBodyFromHandleResult(r: PluginTurnHandleResult): {
  ok: boolean;
  error?: { message?: string; code?: string };
  revision?: number | null;
} {
  try {
    const raw =
      typeof (r as { text?: unknown }).text === "string" ? String((r as { text: string }).text) : "{}";
    return JSON.parse(raw) as {
      ok: boolean;
      error?: { message?: string; code?: string };
      revision?: number | null;
    };
  } catch {
    return { ok: false, error: { message: "无法解析校验结果" } };
  }
}

function p2pTurnErrorLine(r: PluginTurnHandleResult): string {
  const b = p2pTurnBodyFromHandleResult(r);
  return b.error?.message?.trim() || (b.ok ? "" : "校验失败");
}

/** 单条清单项（与落库 lastValidation.checklist 一致） */
type ValidateChecklistItem = { id: string; pass: boolean; detail?: string };

/** `/p2p.validate` 九步编排共享的可变上下文 */
type ValidateRunContext = {
  traceId: string;
  pluginId: string;
  draftPath: string;
  metaPath: string;
  meta: P2pMeta;
  checklist: ValidateChecklistItem[];
  fatal: string[];
  manifestRaw: Record<string, unknown> | null;
  entryRelDefault: string;
  buildStdout: string;
  buildStderr: string;
  srcRuntimePath: string;
  srcOk: boolean;
};

/** 用户提示：草稿与宿主脚本链以 pnpm 为准，勿与 npm 混用 */
const PNPM_NOT_NPM =
  "须使用 pnpm；勿用 `npm install` / `npm i` 替代。草稿在 monorepo 内但通常不是 workspace 成员：请在本目录执行 `pnpm install --ignore-workspace`（或保留本目录 `.npmrc` 中的 `ignore-workspace=true`），否则会只更新仓库根那若干 workspace 包、此处不出现 `node_modules`。";

/** 根据 pnpm / Node 输出归纳「人可读」的失败原因（避免一律归咎 PATH） */
function pnpmBuildFailureHint(
  draftPath: string,
  stdout: string,
  stderr: string,
  opts?: { autoInstallAttempted?: boolean }
): string {
  const combined = `${stdout}\n${stderr}`;
  if (
    /node_modules missing/i.test(combined) ||
    /MODULE_NOT_FOUND/i.test(combined) ||
    /Cannot find module.*node_modules[/\\]@wclaw[/\\]plugin-sdk/i.test(combined)
  ) {
    if (opts?.autoInstallAttempted) {
      return `pnpm run build 失败：已在草稿目录自动执行 pnpm install 并重试构建，仍报依赖/模块错误。请检查「${draftPath}」内 package.json 中 @wclaw/plugin-sdk 的 file: 路径是否指向仓库内 packages/plugin-sdk，以及本机网络与权限。${PNPM_NOT_NPM}`;
    }
    return `pnpm run build 失败：依赖不完整或模块未找到（见 stderr）。full 校验会在草稿目录自动执行 pnpm install 后重试构建。${PNPM_NOT_NPM}`;
  }
  if (/not recognized as an internal or external command/i.test(combined) && /pnpm/i.test(combined)) {
    return "pnpm run build 失败：当前环境找不到 pnpm，请确认已安装并在 PATH 中。";
  }
  return `pnpm run build 失败：请查看 lastValidation / checklist 中 build.pnpm_run_build 的 detail（stderr）。常见原因：草稿目录未执行 pnpm install、或 pnpm/node 不在 PATH。${PNPM_NOT_NPM}`;
}

/** 构建日志是否表现为「缺依赖 / 缺 workspace 包」——可触发自动 pnpm install */
function pnpmOutputSuggestsMissingDeps(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`;
  return (
    /node_modules missing/i.test(combined) ||
    /MODULE_NOT_FOUND/i.test(combined) ||
    /Cannot find module.*@wclaw[/\\]plugin-sdk/i.test(combined)
  );
}

export type ValidateDeps = {
  ctx: TurnContextEmitter;
  draftsRoot: string;
  params: P2pValidateArgs;
};

/**
 * `/p2p.validate`：清单（与宿主 validatePluginSpec 对齐）+ 契约；`full` 时在草稿目录**自动 `pnpm install`（必要时）**后执行 `pnpm run build` 与入口动态 import 冒烟。
 * 依赖安装与构建**仅针对 pnpm**（与 `npm install` / `npm i` 不等价，勿混用）。
 * 九步类方法只做逻辑；`emitTool*` 仅在 `run()` 层，分为两段 toolName：`VALIDATE_TOOL_STATIC`（至步骤⑥）与 `VALIDATE_TOOL_BUILD`（步骤⑦起，含 pnpm 等耗时任务）。
 */
export default class Validate {
  private readonly ctx: TurnContextEmitter;
  private readonly draftsRoot: string;
  private readonly params: P2pValidateArgs;

  constructor(deps: ValidateDeps) {
    this.ctx = deps.ctx;
    this.draftsRoot = deps.draftsRoot;
    this.params = deps.params;
  }

  async run(): Promise<PluginTurnHandleResult> {
    const traceId = createTraceId();
    const pluginId = this.params.pluginId.trim();
    const c: ValidateRunContext = {
      traceId,
      pluginId,
      draftPath: "",
      metaPath: "",
      meta: {} as P2pMeta,
      checklist: [],
      fatal: [],
      manifestRaw: null,
      entryRelDefault: "dist/runtime.mjs",
      buildStdout: "",
      buildStderr: "",
      srcRuntimePath: "",
      srcOk: false
    };

    this.ctx.emitToolRunning(VALIDATE_TOOL_STATIC, {
      pluginId,
      profile: this.params.profile
    });

    let early = await this.stepValidateArgs(c);
    if (early) {
      this.ctx.emitToolError(VALIDATE_TOOL_STATIC, p2pTurnErrorLine(early));
      return early;
    }
    early = await this.stepLoadDraftMeta(c);
    if (early) {
      this.ctx.emitToolError(VALIDATE_TOOL_STATIC, p2pTurnErrorLine(early));
      return early;
    }
    early = await this.stepAssertStatusGenerated(c);
    if (early) {
      this.ctx.emitToolError(VALIDATE_TOOL_STATIC, p2pTurnErrorLine(early));
      return early;
    }

    await this.stepCheckManifest(c);
    await this.stepCheckSrcRuntimeExists(c);
    await this.stepCheckDefaultExportClass(c);

    this.ctx.emitToolAvailable(VALIDATE_TOOL_STATIC, {
      pluginId,
      profile: this.params.profile,
      phase: "static_done",
      checklistCount: c.checklist.length,
      fatalCount: c.fatal.length
    });

    this.ctx.emitToolRunning(VALIDATE_TOOL_BUILD, {
      pluginId,
      profile: this.params.profile,
      phase: "build_and_import"
    });

    await this.stepRunPnpmBuild(c);
    await this.stepCheckBuiltEntryAndImport(c);

    const out = await this.stepPersistMetaAndRespond(c);
    const body = p2pTurnBodyFromHandleResult(out);
    if (body.ok) {
      this.ctx.emitToolAvailable(VALIDATE_TOOL_BUILD, {
        pluginId: c.pluginId,
        profile: this.params.profile,
        phase: "done",
        revision: body.revision ?? null,
        checklistCount: c.checklist.length
      });
    } else {
      this.ctx.emitToolError(VALIDATE_TOOL_BUILD, p2pTurnErrorLine(out));
    }
    return out;
  }

  /** ① 校验 profile / pluginId */
  private async stepValidateArgs(c: ValidateRunContext): Promise<PluginTurnHandleResult | null> {
    if (this.params.invalidProfileArg !== undefined) {
      return p2pJsonTurn({
        ok: false,
        traceId: c.traceId,
        pluginId: c.pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.validate, c.pluginId),
        error: {
          code: "P2P_E_INVALID_ARGS",
          message: `--profile 须为 quick 或 full，收到: ${this.params.invalidProfileArg}`
        }
      });
    }
    if (!c.pluginId || !isValidPluginId(c.pluginId)) {
      return p2pJsonTurn({
        ok: false,
        traceId: c.traceId,
        pluginId: c.pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.validate, c.pluginId),
        error: { code: "P2P_E_INVALID_ARGS", message: "pluginId 非法或缺失" }
      });
    }
    return null;
  }

  /** ② 加载 `.p2p-meta.json` */
  private async stepLoadDraftMeta(c: ValidateRunContext): Promise<PluginTurnHandleResult | null> {
    c.draftPath = path.join(this.draftsRoot, c.pluginId);
    c.metaPath = path.join(c.draftPath, ".p2p-meta.json");
    const meta = await this.readJsonSafe<P2pMeta>(c.metaPath);
    if (!meta || meta.pluginId !== c.pluginId) {
      return p2pJsonTurn({
        ok: false,
        traceId: c.traceId,
        pluginId: c.pluginId,
        status: P2P_STATUS.rejected,
        nextAction: nextActionWithPluginId(P2P_NEXT.initHint, c.pluginId),
        error: {
          code: "P2P_E_DRAFT_NOT_FOUND",
          message: "未找到草稿元数据，请先执行 /p2p.init"
        }
      });
    }
    c.meta = meta;
    return null;
  }

  /** ③ 门禁：status 须为 generated */
  private async stepAssertStatusGenerated(c: ValidateRunContext): Promise<PluginTurnHandleResult | null> {
    if (c.meta.status !== P2P_STATUS.generated) {
      return p2pJsonTurn({
        ok: false,
        traceId: c.traceId,
        pluginId: c.pluginId,
        revision: Number.isInteger(c.meta.revision) ? Number(c.meta.revision) : null,
        status: P2P_STATUS.rejected,
        nextAction:
          c.meta.status === P2P_STATUS.initialized
            ? nextActionWithPluginId(P2P_NEXT.spec, c.pluginId)
            : c.meta.status === P2P_STATUS.spec_ready
              ? nextActionWithPluginId(P2P_NEXT.generate, c.pluginId)
              : c.meta.status === P2P_STATUS.validated
                ? nextActionWithPluginId(P2P_NEXT.test, c.pluginId)
                : nextActionWithPluginId(P2P_NEXT.status, c.pluginId),
        error: {
          code: "P2P_E_VALIDATE_FAILED",
          message: "请先完成 /p2p.generate，使草稿 status 为 generated 后再 validate"
        }
      });
    }
    return null;
  }

  /** ④ 清单 plugin.json */
  private async stepCheckManifest(c: ValidateRunContext): Promise<void> {
    const manifestPath = path.join(c.draftPath, "plugin.json");
    const manifestRaw = await this.readJsonSafe<Record<string, unknown>>(manifestPath);
    c.manifestRaw = manifestRaw;
    if (!manifestRaw) {
      c.fatal.push("缺少 plugin.json");
      return;
    }
    const m = validatePluginSpec(manifestRaw);
    c.checklist.push({
      id: "manifest.validatePluginSpec",
      pass: m.valid,
      detail: m.valid ? undefined : m.errors.join("; ")
    });
    if (!m.valid) c.fatal.push(...m.errors);
    if (String(manifestRaw.kind ?? "") !== P2P_TARGET_KIND) {
      const msg = `Studio 目标 kind 须为 ${P2P_TARGET_KIND}，当前为 ${String(manifestRaw.kind)}`;
      c.checklist.push({ id: "manifest.kind_command_plugin", pass: false, detail: msg });
      c.fatal.push(msg);
    }
    if (String(manifestRaw.id ?? "") !== c.pluginId) {
      const msg = `plugin.json.id（${String(manifestRaw.id)}）与草稿目录名不一致`;
      c.checklist.push({ id: "manifest.id_matches_draft", pass: false, detail: msg });
      c.fatal.push(msg);
    }
    c.entryRelDefault = String(manifestRaw.entry ?? "dist/runtime.mjs").trim() || "dist/runtime.mjs";
  }

  /** ⑤ 存在 src/runtime.ts */
  private async stepCheckSrcRuntimeExists(c: ValidateRunContext): Promise<void> {
    c.srcRuntimePath = path.join(c.draftPath, "src", "runtime.ts");
    c.srcOk = await this.pathExists(c.srcRuntimePath);
    c.checklist.push({
      id: "source.src_runtime_exists",
      pass: c.srcOk,
      detail: c.srcOk ? undefined : "缺少 src/runtime.ts"
    });
    if (!c.srcOk) c.fatal.push("缺少 src/runtime.ts");
  }

  /** ⑥ 源码 export default class 契约 */
  private async stepCheckDefaultExportClass(c: ValidateRunContext): Promise<void> {
    if (!c.srcOk) {
      return;
    }
    const srcText = await fs.readFile(c.srcRuntimePath, "utf-8");
    const contractOk = /\bexport\s+default\s+class\s+\w+/.test(srcText);
    c.checklist.push({
      id: "source.default_export_class",
      pass: contractOk,
      detail: contractOk ? undefined : "src/runtime.ts 须包含 export default class …"
    });
    if (!contractOk) c.fatal.push("src/runtime.ts 须包含 export default class …");
  }

  /**
   * 在草稿目录执行 **`pnpm install --ignore-workspace`**（monorepo 内草稿通常非 workspace 成员，否则 pnpm 只解析根 workspace、本目录无 `node_modules`）。
   * @returns 是否成功（失败时已写入 fatal / checklist）
   */
  private async runPnpmInstallInDraft(c: ValidateRunContext, reason: string): Promise<boolean> {
    try {
      const ir = await runSpawn(c.draftPath, "pnpm", ["install", "--ignore-workspace"], 300_000);
      const installLog = `[pnpm install reason=${reason}]\n${ir.stdout.slice(-6000)}\n${ir.stderr.slice(-6000)}\n\n`;
      c.buildStdout = installLog + c.buildStdout;
      if (!ir.ok) {
        c.buildStderr = ir.stderr.slice(-8000);
      }
      c.checklist.push({
        id: "build.pnpm_install",
        pass: ir.ok,
        detail: ir.ok ? reason : `exit=${ir.code} stderr=${(ir.stderr || "(空)").slice(-1500)}`
      });
      if (!ir.ok) {
        c.fatal.push(
          `自动 pnpm install 失败：${(ir.stderr || ir.stdout || `exit ${String(ir.code)}`).slice(0, 1200)}`
        );
        return false;
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      c.checklist.push({ id: "build.pnpm_install", pass: false, detail: msg });
      c.fatal.push(`pnpm install 启动失败: ${msg}`);
      return false;
    }
  }

  /** ⑦ full：自动 `pnpm install`（必要时）+ `pnpm run build` */
  private async stepRunPnpmBuild(c: ValidateRunContext): Promise<void> {
    if (this.params.profile !== "full" || c.fatal.length > 0) {
      return;
    }
    const pkgPath = path.join(c.draftPath, "package.json");
    if (!(await this.pathExists(pkgPath))) {
      c.fatal.push("缺少 package.json，无法执行 full 构建检查");
      return;
    }

    const nodeModulesPath = path.join(c.draftPath, "node_modules");
    let successfulInstallRuns = 0;
    if (!(await this.pathExists(nodeModulesPath))) {
      if (!(await this.runPnpmInstallInDraft(c, "missing_node_modules"))) {
        return;
      }
      successfulInstallRuns += 1;
    }

    try {
      const runBuild = () =>
        runSpawn(c.draftPath, "pnpm", ["--ignore-workspace", "run", "build"], 240_000);
      let r = await runBuild();
      c.buildStdout += r.stdout.slice(-8000);
      c.buildStderr = r.stderr.slice(-8000);

      if (!r.ok && pnpmOutputSuggestsMissingDeps(r.stdout, r.stderr)) {
        if (await this.runPnpmInstallInDraft(c, "after_failed_build")) {
          successfulInstallRuns += 1;
          r = await runBuild();
          c.buildStdout += `\n--- pnpm run build (retry) ---\n${r.stdout.slice(-6000)}`;
          c.buildStderr = r.stderr.slice(-8000);
        }
      }

      c.checklist.push({
        id: "build.pnpm_run_build",
        pass: r.ok,
        detail: r.ok ? undefined : `exit=${r.code} stderr=${c.buildStderr || "(空)"}`
      });
      if (!r.ok) {
        const hint = pnpmBuildFailureHint(c.draftPath, c.buildStdout, c.buildStderr, {
          autoInstallAttempted:
            successfulInstallRuns > 0 &&
            pnpmOutputSuggestsMissingDeps(c.buildStdout, c.buildStderr)
        });
        c.fatal.push(hint);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      c.checklist.push({ id: "build.pnpm_run_build", pass: false, detail: msg });
      c.fatal.push(`pnpm run build 启动失败: ${msg}`);
    }
  }

  /** ⑧ full：入口文件 + 动态 import */
  private async stepCheckBuiltEntryAndImport(c: ValidateRunContext): Promise<void> {
    if (this.params.profile !== "full" || c.fatal.length > 0) {
      return;
    }
    const entryRel = c.entryRelDefault;
    const entryAbs = path.join(c.draftPath, ...entryRel.split("/").filter(Boolean));
    const entryExists = await this.pathExists(entryAbs);
    c.checklist.push({
      id: "build.entry_file_exists",
      pass: entryExists,
      detail: entryExists ? undefined : `缺少入口文件: ${entryRel}`
    });
    if (!entryExists) {
      c.fatal.push(`构建后仍缺少入口: ${entryRel}`);
      return;
    }
    let importOk = false;
    let importDetail: string | undefined;
    try {
      const href = pathToFileURL(entryAbs).href;
      const mod = await import(href);
      importOk = typeof mod?.default === "function" || typeof mod?.default === "object";
      if (!importOk) importDetail = "入口 default 导出类型异常";
    } catch (e) {
      importDetail = e instanceof Error ? e.message : String(e);
    }
    c.checklist.push({
      id: "build.dynamic_import_default",
      pass: importOk,
      detail: importOk ? undefined : importDetail
    });
    if (!importOk) c.fatal.push(`入口动态 import 失败: ${importDetail ?? ""}`);
  }

  /** ⑨ 写回 meta + 组装 HTTP 风格结果 */
  private async stepPersistMetaAndRespond(c: ValidateRunContext): Promise<PluginTurnHandleResult> {
    const now = toNowIso();
    const nextRevision = Number.isInteger(c.meta.revision) ? Number(c.meta.revision) + 1 : 1;
    const passed = c.fatal.length === 0;
    const lastValidation = {
      profile: this.params.profile,
      at: now,
      ok: passed,
      checklist: c.checklist,
      fatal: c.fatal,
      buildStdout: this.params.profile === "full" ? c.buildStdout : undefined,
      buildStderr: this.params.profile === "full" ? c.buildStderr : undefined
    };
    const nextMeta: P2pMeta = {
      ...c.meta,
      revision: nextRevision,
      lastValidation,
      updatedAt: now,
      ...(passed ? { status: P2P_STATUS.validated } : {})
    };
    await fs.writeFile(c.metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, "utf-8");

    if (passed) {
      return p2pJsonTurn({
        ok: true,
        traceId: c.traceId,
        pluginId: c.pluginId,
        revision: nextRevision,
        status: P2P_STATUS.validated,
        nextAction: nextActionWithPluginId(P2P_NEXT.test, c.pluginId),
        data: {
          draftPath: c.draftPath,
          profile: this.params.profile,
          checklist: c.checklist,
          meta: nextMeta
        }
      });
    }

    return p2pJsonTurn({
      ok: false,
      traceId: c.traceId,
      pluginId: c.pluginId,
      revision: nextRevision,
      status: P2P_STATUS.generated,
      nextAction: nextActionWithPluginId(P2P_NEXT.validate, c.pluginId),
      data: {
        draftPath: c.draftPath,
        profile: this.params.profile,
        checklist: c.checklist,
        lastValidation,
        meta: nextMeta
      },
      error: {
        code: "P2P_E_VALIDATE_FAILED",
        message: c.fatal.join(" | ") || "校验未通过"
      }
    });
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async readJsonSafe<T>(jsonPath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(jsonPath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
