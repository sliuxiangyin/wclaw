import type { PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import type {
  CreateIngestExternalUserTurnFactory,
  CreateReleaseHostMcpContextFactory,
  CreateInvokeHostLlmFactory,
  CreateInvokeHostMcpToolFactory,
  PluginRuntimePort
} from "../../core/plugin-runtime.port.js";
import type { PluginObjectItem } from "../../core/plugin-object.types.js";
import type { HostEventHub } from "../host-event-hub-provider/host-event-hub.js";
import { PluginLoading } from "./plugin-loading.js";

type BootstrapLog = {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
};

/**
 * 插件目录 + 运行时：内部持有 `PluginLoading`（构造时赋值给 `pluginLoading`）。
 * **禁止**在 `constructor` 内 `await`；异步初始化请用 `PluginRuntimeProvider.create()`。
 */
export class PluginRuntimeProvider implements PluginRuntimePort {
  public readonly pluginLoading: PluginLoading;

  private constructor(pluginLoading: PluginLoading) {
    this.pluginLoading = pluginLoading;
  }

  /**
   * 组合根唯一异步入口：`await PluginLoading.create` 完成后注入本类。
   */
  static async create(options: {
    hostEventHub: HostEventHub;
    log: BootstrapLog;
  }): Promise<PluginRuntimeProvider> {
    const { hostEventHub, log } = options;
    const publish = hostEventHub.getPublish();
    const pluginLoading = await PluginLoading.create({ publish, log });
    return new PluginRuntimeProvider(pluginLoading);
  }

  async listPlugins(): Promise<{ items: PluginObjectItem[] }> {
    return { items: await this.pluginLoading.plugins() };
  }

  async plugin(pluginId: string): Promise<PluginObjectItem | null> {
    return this.pluginLoading.get(pluginId) ?? null;
  }

 
  /**
   * 为已加载的 `runtime_plugin` 注入 `ingestExternalUserTurn`；
   * `getPluginRuntime()` 指向本 Provider（满足 `PluginRuntimePort`）。
   */
  setIngestExternalUserTurn(factory: CreateIngestExternalUserTurnFactory): void {
    for (const row of this.pluginLoading.snapshot()) {
      if (row.manifest?.kind !== "runtime_plugin") continue;
      const ext = row.object;
      if (!ext) continue;
      const ingest = factory({ pluginId: row.pluginId, getPluginRuntime: () => this });
      Object.assign(ext as PluginRuntimeExtension & { ingestExternalUserTurn?: typeof ingest }, {
        ingestExternalUserTurn: ingest
      });
    }
  }

  /**
   * 为已加载的 `runtime_plugin` / `command_plugin` 实例挂上 `invokeHostMcpTool`（command 插件亦可通过宿主网关测 MCP）。
   */
  setInvokeHostMcpTool(factory: CreateInvokeHostMcpToolFactory): void {
    for (const row of this.pluginLoading.snapshot()) {
      const kind = row.manifest?.kind;
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      const ext = row.object;
      if (!ext) continue;
      const invoke = factory({ pluginId: row.pluginId, getPluginRuntime: () => this });
      Object.assign(ext as PluginRuntimeExtension & { invokeHostMcpTool?: typeof invoke }, {
        invokeHostMcpTool: invoke
      });
    }
  }

  setReleaseHostMcpContext(factory: CreateReleaseHostMcpContextFactory): void {
    for (const row of this.pluginLoading.snapshot()) {
      const kind = row.manifest?.kind;
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      const ext = row.object;
      if (!ext) continue;
      const release = factory({ pluginId: row.pluginId, getPluginRuntime: () => this });
      Object.assign(ext as PluginRuntimeExtension & { releaseHostMcpContext?: typeof release }, {
        releaseHostMcpContext: release
      });
    }
  }

  /**
   * 为允许使用宿主 LLM 的插件挂上 `invokeHostLlm`：
   * - runtime_plugin: 总是允许
   * - command_plugin: 除 `ephemeral_no_context` 外允许
   */
  setInvokeHostLlm(factory: CreateInvokeHostLlmFactory): void {
    for (const row of this.pluginLoading.snapshot()) {
      const kind = row.manifest?.kind;
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      if (kind === "command_plugin" && row.manifest?.commandMode === "ephemeral_no_context") continue;
      const ext = row.object;
      if (!ext) continue;
      const invokeLlm = factory({ pluginId: row.pluginId, getPluginRuntime: () => this });
      Object.assign(ext as PluginRuntimeExtension & { invokeHostLlm?: typeof invokeLlm }, {
        invokeHostLlm: invokeLlm
      });
    }
  }
}
