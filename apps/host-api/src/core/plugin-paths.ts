import fs from "node:fs/promises";
import path from "node:path";

const pluginsRootPromise = resolvePluginsRootImpl();

async function resolvePluginsRootImpl(): Promise<string> {
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const marker = path.join(current, "pnpm-workspace.yaml");
    try {
      await fs.access(marker);
      return path.join(current, "plugins");
    } catch {
      current = path.dirname(current);
    }
  }
  return path.resolve(process.cwd(), "plugins");
}

/** 解析 monorepo 下 `plugins/` 根目录（与 catalog 扫描一致）。 */
export function getPluginsRoot(): Promise<string> {
  return pluginsRootPromise;
}

export async function resolvePluginEntryAbsolutePath(
  pluginId: string,
  relativeEntry: string
): Promise<string> {
  const root = await pluginsRootPromise;
  return path.join(root, pluginId, relativeEntry);
}
