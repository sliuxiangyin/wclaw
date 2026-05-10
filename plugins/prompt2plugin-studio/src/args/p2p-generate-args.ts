import { findArgValue } from "../tools.js";

/** 解析 `/p2p.generate <plugin-id> [--templateVersion v1]`（argv 为 parseCommand 的 args）。 */
export type P2pGenerateArgs = {
  pluginId: string;
  /** 模板版本；当前仅实现 `v1` */
  templateVersion: string;
};

export function parseP2pGenerateArgs(args: string[]): P2pGenerateArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const raw = findArgValue(args, "--templateVersion");
  const templateVersion =
    raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : "v1";
  return { pluginId, templateVersion };
}
