import type { PluginClearSessionContext } from "@wclaw/plugin-sdk";

/** 宿主清空该会话聊天记录前调用：当前无需清理会话映射缓存。 */
export function clearSession(_pluginId: string, _ctx: PluginClearSessionContext): void {
  return;
}
