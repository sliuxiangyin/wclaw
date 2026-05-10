import { findArgValue } from "../tools.js";

/** 解析 `/p2p.init <plugin-id> [--commandMode <mode>]` 的 argv 片段（即 parseCommand 的 args）。 */
export type P2pInitArgs = {
    pluginName: string;
    commandMode: string | undefined;
  };
  
  export function parseP2pInitArgs(args: string[]): P2pInitArgs {
    const pluginName = args[0] ? String(args[0]).trim() : "";
    const raw = findArgValue(args, "--commandMode");
    const commandMode =
      raw !== undefined && String(raw).trim() !== "" ? String(raw).trim() : undefined;
    return { pluginName, commandMode };
  }