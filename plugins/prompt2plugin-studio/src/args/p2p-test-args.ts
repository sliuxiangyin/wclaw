import { findArgValue } from "../tools.js";

/** 解析 `/p2p.test <plugin-id> [--suite smoke|full]`。 */
export type P2pTestArgs = {
  pluginId: string;
  suite: "smoke" | "full";
  invalidSuiteArg?: string;
};

export function parseP2pTestArgs(args: string[]): P2pTestArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const raw = findArgValue(args, "--suite");
  if (raw === undefined || String(raw).trim() === "") {
    return { pluginId, suite: "smoke" };
  }
  const s = String(raw).trim().toLowerCase();
  if (s !== "smoke" && s !== "full") {
    return { pluginId, suite: "smoke", invalidSuiteArg: String(raw).trim() };
  }
  return { pluginId, suite: s as "smoke" | "full" };
}
