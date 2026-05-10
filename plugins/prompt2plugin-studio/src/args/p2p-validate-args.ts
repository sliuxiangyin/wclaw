import { findArgValue } from "../tools.js";

/** 解析 `/p2p.validate <plugin-id> [--profile quick|full]`（argv 为 parseCommand 的 args）。 */
export type P2pValidateArgs = {
  pluginId: string;
  /** `quick`：清单 + 源码契约；`full`：另含草稿目录内 `pnpm run build` 与入口可加载冒烟 */
  profile: "quick" | "full";
  /** 若用户传了非法的 `--profile` 取值，为原始字符串，handler 应拒绝 */
  invalidProfileArg?: string;
};

export function parseP2pValidateArgs(args: string[]): P2pValidateArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const raw = findArgValue(args, "--profile");
  if (raw === undefined || String(raw).trim() === "") {
    return { pluginId, profile: "full" };
  }
  const p = String(raw).trim().toLowerCase();
  if (p !== "quick" && p !== "full") {
    return { pluginId, profile: "full", invalidProfileArg: String(raw).trim() };
  }
  return { pluginId, profile: p as "quick" | "full" };
}
