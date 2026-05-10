import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PathNodeCheckResult =
  | { ok: true; version: string }
  | { ok: false; code: "P2P_E_NODE_NOT_FOUND"; message: string };

/**
 * 检测当前进程环境下 PATH 中的 `node` 是否可执行（`node --version`）。
 * 用于 `/p2p.init`：后续草稿在目录内 `pnpm run build` 时会再起子进程调用 `node`/`pnpm exec`。
 */
export async function checkPathNodeForBuild(): Promise<PathNodeCheckResult> {
  try {
    const { stdout } = await execFileAsync("node", ["--version"], {
      timeout: 8000,
      windowsHide: true,
      env: process.env
    });
    const version = String(stdout || "").trim();
    if (!/^v\d/i.test(version)) {
      return {
        ok: false,
        code: "P2P_E_NODE_NOT_FOUND",
        message: "已执行 node --version，但输出异常，请检查全局 Node 安装"
      };
    }
    return { ok: true, version };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: "P2P_E_NODE_NOT_FOUND",
      message:
        "PATH 中未找到可执行的 node（草稿在 generate 之后需在本机执行 pnpm build，依赖与 host-api 相同环境下的全局 node）。请安装 Node 20 LTS 并确保 shell 中能运行 `node --version`。" +
        (detail ? ` 详情: ${detail}` : "")
    };
  }
}
