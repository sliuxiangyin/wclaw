import type { PluginRuntimeExtension, PluginRuntimeExtensionDeps, PluginSessionRow } from "@wclaw/plugin-sdk";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginManifest, PluginObjectItem } from "../../core/plugin-object.types.js";
import { getPluginsRoot, resolvePluginEntryAbsolutePath } from "../../core/plugin-paths.js";
import { validatePluginSpec } from "../../core/validate-plugin-spec.js";

/**
 * 仅磁盘扫描阶段使用：尚无运行时 `object`，加载完成后合并为 `PluginObjectItem`。
 * （不使用已废弃的 `PluginCatalogItem` 命名。）
 */
type ManifestScanRow = {
  pluginId: string;
  status: "valid" | "invalid";
  manifestPath: string;
  manifest?: PluginManifest;
  errors?: string[];
};

type BootstrapLog = {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
};

/**
 * 仅本模块与宿主侧 ingest 工厂配套：`getPluginRuntime()` 的最小形状（`PluginLoading.setIngestExternalUserTurn` 可选路径），
 * 列表项统一为 `PluginObjectItem`（不依赖宿主 `plugin-runtime.port` 的命名）。
 */
export type PluginLoadingIngestRuntimePort = {
  plugin(pluginId: string): Promise<PluginObjectItem | null>;
  listPlugins(): Promise<{ items: PluginObjectItem[] }>;
  setIngestExternalUserTurn(factory: CreatePluginLoadingIngestFactory): void;
  setInvokeHostMcpTool(factory: CreatePluginLoadingInvokeHostMcpToolFactory): void;
  setReleaseHostMcpContext(factory: CreatePluginLoadingReleaseHostMcpContextFactory): void;
  setInvokeHostLlm(factory: CreatePluginLoadingInvokeHostLlmFactory): void;
};

export type PluginLoadingIngestFactoryInput = {
  pluginId: string;
  getPluginRuntime: () => PluginLoadingIngestRuntimePort;
};

export type CreatePluginLoadingIngestFactory = (
  input: PluginLoadingIngestFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["ingestExternalUserTurn"]>;

export type CreatePluginLoadingInvokeHostMcpToolFactory = (
  input: PluginLoadingIngestFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["invokeHostMcpTool"]>;

export type CreatePluginLoadingReleaseHostMcpContextFactory = (
  input: PluginLoadingIngestFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["releaseHostMcpContext"]>;

export type CreatePluginLoadingInvokeHostLlmFactory = (
  input: PluginLoadingIngestFactoryInput
) => NonNullable<PluginRuntimeExtensionDeps["invokeHostLlm"]>;

async function readSubDirs(dir: string): Promise<string[]> {
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
      isDirectory(): boolean;
      name: string;
    }>;
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * 扫描 `plugins/` 下各子目录的 `plugin.json`。
 */
async function scanDiskCatalog(): Promise<{ rows: ManifestScanRow[] }> {
  const pluginsRoot = await getPluginsRoot();
  const pluginDirs = await readSubDirs(pluginsRoot);
  const rows: ManifestScanRow[] = [];

  for (const dir of pluginDirs) {
    const pluginId = path.basename(dir);
    const manifestPath = path.join(dir, "plugin.json");
    const relativeManifestPath = path.relative(process.cwd(), manifestPath);
    const raw = await tryRead(manifestPath);

    if (!raw) {
      rows.push({
        pluginId,
        status: "invalid",
        manifestPath: relativeManifestPath,
        errors: ["缺少 plugin.json"]
      });
      continue;
    }

    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const result = validatePluginSpec(json);
      if (!result.valid) {
        rows.push({
          pluginId,
          status: "invalid",
          manifestPath: relativeManifestPath,
          errors: result.errors
        });
        continue;
      }

      rows.push({
        pluginId,
        status: "valid",
        manifestPath: relativeManifestPath,
        manifest: {
          id: String(json.id),
          displayName: String(json.displayName),
          kind: json.kind as PluginManifest["kind"],
          commandMode: json.commandMode as PluginManifest["commandMode"],
          version: String(json.version),
          description: String(json.description),
          systemPrompt: String(json.systemPrompt),
          entry: String(json.entry ?? ""),
          mcp: (json.mcp as PluginManifest["mcp"] | undefined) ?? undefined,
          sessionProvider: (json.sessionProvider as Record<string, unknown> | undefined) ?? undefined,
          configSchema: (json.configSchema as Record<string, unknown> | undefined) ?? undefined,
          defaultConfig: (json.defaultConfig as Record<string, unknown> | undefined) ?? undefined
        }
      });
    } catch {
      rows.push({
        pluginId,
        status: "invalid",
        manifestPath: relativeManifestPath,
        errors: ["plugin.json 不是合法 JSON"]
      });
    }
  }

  return { rows };
}

/**
 * 对已通过校验的清单行 `import(entry)` 并 `new` 默认导出类。
 */
async function loadRuntimeInstances(
  rows: ManifestScanRow[],
  publish: PluginRuntimeExtensionDeps["publish"],
  log: BootstrapLog
): Promise<{
  map: Map<string, PluginRuntimeExtension>;
  pluginKinds: Map<string, PluginManifest["kind"]>;
}> {
  const map = new Map<string, PluginRuntimeExtension>();
  const pluginKinds = new Map<string, PluginManifest["kind"]>();

  for (const row of rows) {
    if (row.status !== "valid" || !row.manifest?.entry) continue;
    const { pluginId } = row;
    pluginKinds.set(pluginId, row.manifest.kind);
    const entry = row.manifest.entry;
    if (entry.includes("..")) {
      log.warn({ pluginId, entry }, "plugin runtime skipped: invalid entry path");
      continue;
    }

    const abs = await resolvePluginEntryAbsolutePath(pluginId, entry);
    try {
      await fs.access(abs);
    } catch {
      log.warn({ pluginId, entry, abs }, "plugin runtime skipped: entry file not found");
      continue;
    }

    try {
      const ns = (await import(pathToFileURL(abs).href)) as { default?: unknown };
      const Ctor = ns.default;
      if (typeof Ctor !== "function") {
        log.warn({ pluginId, entry }, "plugin runtime skipped: default export is not a constructor");
        continue;
      }
      const workspaceDir = path.join(process.cwd(), "var", "plugin-workspaces", pluginId);
      await fs.mkdir(workspaceDir, { recursive: true });
      const deps: PluginRuntimeExtensionDeps = { pluginId, publish, workspaceDir };
      const ctor = Ctor as new (d: PluginRuntimeExtensionDeps) => PluginRuntimeExtension;
      const instance = new ctor(deps);
      map.set(pluginId, instance);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ pluginId, entry, err: message }, "plugin runtime skipped: load or instantiate failed");
    }
  }

  return { map, pluginKinds };
}

function buildPluginObjectItems(
  rows: ManifestScanRow[],
  instances: ReadonlyMap<string, PluginRuntimeExtension>
): PluginObjectItem[] {
  return rows.map((row) => {
    const loaded: PluginRuntimeExtension | undefined = instances.get(row.pluginId);
    const base: PluginObjectItem = {
      pluginId: row.pluginId,
      status: row.status,
      manifestPath: row.manifestPath,
      manifest: row.manifest,
      errors: row.errors
    };

    if (loaded === undefined) return base;
    const getSessionRow = async (sessionId: string): Promise<PluginSessionRow> => {
      const sid = String(sessionId || "").trim();
      const fallback: PluginSessionRow = {
        sessionId: sid || `${row.pluginId}:default`,
        updatedAt: new Date().toISOString()
      };
      if (!loaded.decorateSessions) return fallback;
      try {
        const rows = await Promise.resolve(loaded.decorateSessions());
        return rows.find((item) => item.sessionId === sid) ?? fallback;
      } catch {
        return fallback;
      }
    };
    return { ...base, object: loaded, getSessionRow };
  });
}

/**
 * 供 `ingestExternalUserTurn` 工厂中的 `getPluginRuntime()`：
 * 每次列表/按 id 查询均重新扫盘并与当前 `instances` 合并为 `PluginObjectItem`。
 */
function createIngestRuntimePortView(
  getInstances: () => Map<string, PluginRuntimeExtension>
): PluginLoadingIngestRuntimePort {
  return {
    listPlugins: async () => {
      const { rows } = await scanDiskCatalog();
      return { items: buildPluginObjectItems(rows, getInstances()) };
    },
    plugin: async (pluginId: string) => {
      const { rows } = await scanDiskCatalog();
      const items = buildPluginObjectItems(rows, getInstances());
      return items.find((x) => x.pluginId === pluginId) ?? null;
    },
    setIngestExternalUserTurn: () => {
      throw new Error("ingest port view: call PluginLoading.setIngestExternalUserTurn on the host loader");
    },
    setInvokeHostMcpTool: () => {
      throw new Error("invokeHostMcpTool port view: call PluginLoading.setInvokeHostMcpTool on the host loader");
    },
    setReleaseHostMcpContext: () => {
      throw new Error("releaseHostMcpContext port view: call PluginLoading.setReleaseHostMcpContext on the host loader");
    },
    setInvokeHostLlm: () => {
      throw new Error("invokeHostLlm port view: call PluginLoading.setInvokeHostLlm on the host loader");
    }
  };
}

/**
 * 插件加载与 `PluginObjectItem` 聚合（`@wclaw/plugin-sdk` 运行时）；扫描、实例化、`ingestExternalUserTurn` / `invokeHostMcpTool` / `invokeHostLlm`（可选镜像路径）注入。
 */
export class PluginLoading {
  private readonly items: PluginObjectItem[];
  private readonly instances: Map<string, PluginRuntimeExtension>;
  private readonly pluginKinds: Map<string, PluginManifest["kind"]>;

  private constructor(
    instances: Map<string, PluginRuntimeExtension>,
    pluginKinds: Map<string, PluginManifest["kind"]>,
    items: PluginObjectItem[]
  ) {
    this.instances = instances;
    this.pluginKinds = pluginKinds;
    this.items = items;
  }

  /**
   * 扫描 `plugins/`、校验、预加载实例并构建 `PluginObjectItem` 快照。
   */
  static async create(options: {
    publish: PluginRuntimeExtensionDeps["publish"];
    log: BootstrapLog;
  }): Promise<PluginLoading> {
    const { publish, log } = options;
    const { rows } = await scanDiskCatalog();
    const { map, pluginKinds } = await loadRuntimeInstances(rows, publish, log);
    const objectItems = buildPluginObjectItems(rows, map);
    return new PluginLoading(map, pluginKinds, objectItems);
  }

  /**
   * 获取当前快照下的全部 `PluginObjectItem`。
   */
  async plugins(): Promise<PluginObjectItem[]> {
    return [...this.items];
  }

  /** 与 `plugins()` 相同数据，同步返回（供 `setIngestExternalUserTurn` 等须同步完成的场景）。 */
  snapshot(): PluginObjectItem[] {
    return [...this.items];
  }

  /**
   * 按 `pluginId` 获取单个 `PluginObjectItem`；不存在时返回 `undefined`。
   */
  get(pluginId: string): PluginObjectItem | undefined {
    return this.items.find((x) => x.pluginId === pluginId);
  }

  /**
   * 为各 `runtime_plugin` 实例挂上 `ingestExternalUserTurn`。
   */
  setIngestExternalUserTurn(factory: CreatePluginLoadingIngestFactory): void {
    const portView = createIngestRuntimePortView(() => this.instances);
    for (const [pluginId, ext] of this.instances) {
      if (this.pluginKinds.get(pluginId) !== "runtime_plugin") continue;
      const ingest = factory({ pluginId, getPluginRuntime: () => portView });
      Object.assign(ext as PluginRuntimeExtension & { ingestExternalUserTurn?: typeof ingest }, {
        ingestExternalUserTurn: ingest
      });
    }
  }

  /**
   * 为各 `runtime_plugin` / `command_plugin` 实例挂上 `invokeHostMcpTool`。
   */
  setInvokeHostMcpTool(factory: CreatePluginLoadingInvokeHostMcpToolFactory): void {
    const portView = createIngestRuntimePortView(() => this.instances);
    for (const [pluginId, ext] of this.instances) {
      const kind = this.pluginKinds.get(pluginId);
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      const invoke = factory({ pluginId, getPluginRuntime: () => portView });
      Object.assign(ext as PluginRuntimeExtension & { invokeHostMcpTool?: typeof invoke }, {
        invokeHostMcpTool: invoke
      });
    }
  }

  setReleaseHostMcpContext(factory: CreatePluginLoadingReleaseHostMcpContextFactory): void {
    const portView = createIngestRuntimePortView(() => this.instances);
    for (const [pluginId, ext] of this.instances) {
      const kind = this.pluginKinds.get(pluginId);
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      const release = factory({ pluginId, getPluginRuntime: () => portView });
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
  setInvokeHostLlm(factory: CreatePluginLoadingInvokeHostLlmFactory): void {
    const portView = createIngestRuntimePortView(() => this.instances);
    for (const item of this.items) {
      const kind = item.manifest?.kind;
      if (kind !== "runtime_plugin" && kind !== "command_plugin") continue;
      if (kind === "command_plugin" && item.manifest?.commandMode === "ephemeral_no_context") continue;
      const ext = this.instances.get(item.pluginId);
      if (!ext) continue;
      const invoke = factory({ pluginId: item.pluginId, getPluginRuntime: () => portView });
      Object.assign(ext as PluginRuntimeExtension & { invokeHostLlm?: typeof invoke }, {
        invokeHostLlm: invoke
      });
    }
  }
}

export type { PluginObjectItem } from "../../core/plugin-object.types.js";
