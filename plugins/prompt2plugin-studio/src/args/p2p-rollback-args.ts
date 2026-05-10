import { findArgValue } from "../tools.js";

/** 解析 `/p2p.rollback <plugin-id> <revision>` 或 `--revision <n>`。 */
export type P2pRollbackArgs = {
  pluginId: string;
  revision?: number;
  invalidRevisionArg?: string;
};

export function parseP2pRollbackArgs(args: string[]): P2pRollbackArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const flag = findArgValue(args, "--revision");
  if (flag !== undefined && String(flag).trim() !== "") {
    const n = Number.parseInt(String(flag).trim(), 10);
    if (!Number.isInteger(n) || n < 1) {
      return { pluginId, invalidRevisionArg: String(flag).trim() };
    }
    return { pluginId, revision: n };
  }
  const second = args[1] ? String(args[1]).trim() : "";
  if (second === "") {
    return { pluginId };
  }
  const n = Number.parseInt(second, 10);
  if (!Number.isInteger(n) || n < 1) {
    return { pluginId, invalidRevisionArg: second };
  }
  return { pluginId, revision: n };
}
