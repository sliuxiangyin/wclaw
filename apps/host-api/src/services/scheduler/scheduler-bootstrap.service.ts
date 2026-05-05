import type { PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { registerPluginTasks } from "./scheduler-registry.service.js";
import { startSchedulerRunner, stopSchedulerRunner } from "./scheduler-runner.service.js";

export async function bootstrapScheduler(pluginRuntime: PluginRuntimePort) {
  const catalog = await pluginRuntime.listPlugins();
  for (const item of catalog.items) {
    if (item.status !== "valid" || !item.manifest) continue;
    if (item.manifest.kind !== "runtime_plugin") continue;
    const row = await pluginRuntime.plugin(item.pluginId);
    const runtime = row?.object as PluginRuntimeExtension | undefined;
    const tasks = runtime?.getScheduledTasks ? runtime.getScheduledTasks() : [];
    registerPluginTasks(item.pluginId, tasks);
  }
  startSchedulerRunner(pluginRuntime);
}

export function shutdownScheduler() {
  stopSchedulerRunner();
}
