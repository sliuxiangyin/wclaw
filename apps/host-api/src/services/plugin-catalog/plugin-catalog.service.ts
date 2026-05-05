import { resolvePluginEntryAbsolutePath as resolvePluginEntryPath } from "../../core/plugin-paths.js";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { PluginObjectItem } from "../../providers/plugin-runtime-provider/plugin-loading.js";

export type { PluginManifest, PluginObjectItem } from "../../core/plugin-object.types.js";

let catalogDelegate: PluginRuntimePort | null = null;

/**
 * 临时桥接：`listPlugins` / `plugin` 仍从本模块导出，实现委托给 `PluginRuntimeProvider` 实例。
 * `createApp` 在 `PluginRuntimeProvider.create` 成功后须调用一次。
 */
export function bindPluginCatalogProvider(provider: PluginRuntimePort): void {
  catalogDelegate = provider;
}

function requireDelegate(): PluginRuntimePort {
  if (!catalogDelegate) {
    throw new Error(
      "plugin catalog: delegate not bound; call bindPluginCatalogProvider after PluginRuntimeProvider.create"
    );
  }
  return catalogDelegate;
}

export async function listPlugins() {
  return requireDelegate().listPlugins();
}

export async function plugin(pluginId: string) {
  return requireDelegate().plugin(pluginId) as Promise<PluginObjectItem|null>;
}

/** @deprecated 请使用 `core/plugin-paths` 的 `resolvePluginEntryAbsolutePath` */
export async function resolvePluginEntryAbsolutePath(
  pluginId: string,
  relativeEntry: string
): Promise<string> {
  return resolvePluginEntryPath(pluginId, relativeEntry);
}
