import { findArgValue } from "../tools.js";

/** 解析 `/p2p.promote <plugin-id> [--expectedRevision <n>]`。 */
export type P2pPromoteArgs = {
  pluginId: string;
  /** 与当前草稿 `.p2p-meta.json` 的 `revision` 一致时才允许晋升（可选） */
  expectedRevision?: number;
  invalidExpectedRevision?: string;
};

export function parseP2pPromoteArgs(args: string[]): P2pPromoteArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const raw = findArgValue(args, "--expectedRevision");
  if (raw === undefined || String(raw).trim() === "") {
    return { pluginId };
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    return { pluginId, invalidExpectedRevision: String(raw).trim() };
  }
  return { pluginId, expectedRevision: n };
}
