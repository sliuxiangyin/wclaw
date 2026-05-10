/** 解析 `/p2p.status <plugin-id>`。 */
export type P2pStatusArgs = {
  pluginId: string;
};

export function parseP2pStatusArgs(args: string[]): P2pStatusArgs {
  return { pluginId: args[0] ? String(args[0]).trim() : "" };
}
