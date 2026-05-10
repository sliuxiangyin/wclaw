/** 解析 `/p2p.spec <plugin-id> <需求描述>`（argv 为 parseCommand 的 args；首个 token 为插件 id，其余拼接为 text）。 */
export type P2pSpecArgs = {
  pluginId: string;
  text: string;
};

export function parseP2pSpecArgs(args: string[]): P2pSpecArgs {
  const pluginId = args[0] ? String(args[0]).trim() : "";
  const text = args.slice(1).join(" ").trim();
  return { pluginId, text };
}
