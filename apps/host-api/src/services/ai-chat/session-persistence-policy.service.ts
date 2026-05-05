import type { PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";

export type SessionPersistDecision = (sessionId: string) => boolean;
export type SessionForceExecuteTurnDecision = (sessionId: string) => boolean;

/**
 * 统一会话持久化策略：
 * - 默认持久化（true）
 * - 若插件 decorateSessions 声明 persistence=ephemeral，则该 session 不落库
 */
export async function resolveSessionPersistDecision(
  pluginRuntime: PluginRuntimePort,
  pluginId: string
): Promise<SessionPersistDecision> {
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (!runtime?.decorateSessions) {
    return () => true;
  }
  try {
    const rows = await Promise.resolve(runtime.decorateSessions());
    const policyMap = new Map<string, "persist" | "ephemeral">();
    for (const row of rows) {
      policyMap.set(row.sessionId, row.persistence ?? "persist");
    }
    return (sessionId: string) => policyMap.get(sessionId) !== "ephemeral";
  } catch {
    return () => true;
  }
}

/**
 * runtime_plugin 会话入口策略：
 * - 默认 false（不强制进入 executeTurn）
 * - 若 decorateSessions 声明 forceExecuteTurn=true，则该会话无条件进入 executeTurn
 */
export async function resolveSessionForceExecuteTurnDecision(
  pluginRuntime: PluginRuntimePort,
  pluginId: string
): Promise<SessionForceExecuteTurnDecision> {
  const row = await pluginRuntime.plugin(pluginId);
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (!runtime?.decorateSessions) {
    return () => false;
  }
  try {
    const rows = await Promise.resolve(runtime.decorateSessions());
    const policyMap = new Map<string, boolean>();
    for (const row of rows) {
      policyMap.set(row.sessionId, row.forceExecuteTurn === true);
    }
    return (sessionId: string) => policyMap.get(sessionId) === true;
  } catch {
    return () => false;
  }
}
