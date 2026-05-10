import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginTurnContext, PluginTurnHandleResult } from "@wclaw/plugin-sdk";
import { toTurnResult } from "@wclaw/plugin-sdk";

export type P2pResultBody = {
  ok: boolean;
  traceId: string;
  pluginId: string | null;
  revision: number | null;
  status: string | null;
  nextAction: string | null;
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

export function createTraceId(): string {
  return `p2p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toNowIso(): string {
  return new Date().toISOString();
}

export function isValidPluginId(pluginId: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(pluginId);
}

export function parseSimpleTokens(input: string): string[] {
  return String(input || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function parseCommand(ctx: PluginTurnContext): { command: string; args: string[] } {
  if (ctx.argv?.command) {
    const command = String(ctx.argv.command).startsWith("/")
      ? String(ctx.argv.command)
      : `/${String(ctx.argv.command)}`;
    return {
      command,
      args: Array.isArray(ctx.argv.args) ? ctx.argv.args.map((x) => String(x)) : []
    };
  }
  const tokens = parseSimpleTokens(ctx.message);
  if (tokens.length === 0) return { command: "", args: [] };
  return {
    command: tokens[0] ?? "",
    args: tokens.slice(1)
  };
}

export function findArgValue(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx < 0) return undefined;
  const value = args[idx + 1];
  return value ? String(value) : undefined;
}



export function buildResult(params: {
  ok: boolean;
  traceId: string;
  pluginId: string;
  revision?: number | null;
  status: string;
  nextAction: string;
  data?: Record<string, unknown> | null;
  error?: { code: string; message: string } | null;
}): P2pResultBody {
  const { ok, traceId, pluginId, revision, status, nextAction, data, error } = params;
  return {
    ok,
    traceId,
    pluginId: pluginId || null,
    revision: Number.isInteger(revision) ? (revision as number) : null,
    status: status || null,
    nextAction: nextAction || null,
    data: data ?? null,
    error: error ?? null
  };
}

/** 结构化 `buildResult` → `executeTurn` 文本（单一格式出口） */
export function p2pText(
  params: Parameters<typeof buildResult>[0]
): PluginTurnHandleResult {
  return { text: JSON.stringify(buildResult(params), null, 2) };
}

/** 与 `p2pText` 相同载荷，统一经 `toTurnResult` 出口 */
export function p2pJsonTurn(params: Parameters<typeof buildResult>[0]): PluginTurnHandleResult {
  return toTurnResult(JSON.stringify(buildResult(params), null, 2));
}

/** 将 `P2P_NEXT` 等模板里的占位符替换为真实草稿 `pluginId`。 */
export function nextActionWithPluginId(template: string, id: string): string {
  return template.includes("<plugin-id>") ? template.replace("<plugin-id>", id) : template;
}

/** 审计：追加一行 JSON 至 `plugins/.drafts/_audit/events.jsonl`（MVP，与实施方案 9.3 对齐的落盘形态）。 */
export async function appendPrompt2PluginAudit(
  draftsRoot: string,
  record: Record<string, unknown>
): Promise<void> {
  const dir = path.join(draftsRoot, "_audit");
  await fs.mkdir(dir, { recursive: true });
  const line = `${JSON.stringify({ ...record, time: new Date().toISOString() })}\n`;
  await fs.appendFile(path.join(dir, "events.jsonl"), line, "utf-8");
}

const PROMOTE_COPY_SKIP_TOP = new Set([
  "node_modules",
  ".git",
  ".p2p-meta.json",
  ".p2p-snapshots",
  "_snapshots",
  "_audit"
]);

/**
 * 将目录树复制到目标（用于 promote / 快照）：跳过 `node_modules`、`_audit`、以 `.p2p` 开头的条目及 `_snapshots`。
 */
export async function copyDirectoryForPromote(srcDir: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  await fs.cp(srcDir, destDir, {
    recursive: true,
    force: true,
    filter: (srcPath) => {
      const rel = path.relative(srcDir, srcPath);
      if (!rel || rel === ".") return true;
      const top = rel.split(path.sep)[0] ?? "";
      if (PROMOTE_COPY_SKIP_TOP.has(top)) return false;
      if (top.startsWith(".p2p")) return false;
      return true;
    }
  });
}

const PLUGIN_SDK_PKG = "@wclaw/plugin-sdk";

/** 子进程执行（pnpm 等）；超时发 SIGTERM 并以非 0 结束。 */
export function runSpawn(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += String(c);
    });
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr, code: null });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, stdout, stderr, code: code ?? null });
    });
  });
}

type PackageJsonLike = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * 将 `package.json` 中的 `@wclaw/plugin-sdk` 设为指向仓库内 SDK 目录的 `file:` 相对路径（便于日后改为 git/npm 源，不绑 `workspace:*`）。
 */
export async function setPluginSdkDependencyToLocalFile(
  packageRootDir: string,
  pluginSdkDirAbs: string
): Promise<void> {
  const pkgPath = path.join(packageRootDir, "package.json");
  let raw: string;
  try {
    raw = await fs.readFile(pkgPath, "utf-8");
  } catch {
    return;
  }
  const pkg = JSON.parse(raw) as PackageJsonLike;
  const rel = path.relative(packageRootDir, pluginSdkDirAbs);
  if (!rel || path.isAbsolute(rel)) {
    return;
  }
  const posixRel = rel.split(path.sep).join("/");
  const fileSpec = posixRel.startsWith(".") ? `file:${posixRel}` : `file:./${posixRel}`;

  let changed = false;
  const setRec = (rec: Record<string, string> | undefined): void => {
    if (!rec || !(PLUGIN_SDK_PKG in rec)) return;
    if (rec[PLUGIN_SDK_PKG] !== fileSpec) {
      rec[PLUGIN_SDK_PKG] = fileSpec;
      changed = true;
    }
  };
  setRec(pkg.dependencies);
  setRec(pkg.devDependencies);
  if (changed) {
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  }
}
