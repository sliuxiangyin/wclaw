import type {
  ExternalUserTurnInput,
  ExternalUserTurnResult,
  HostLlmInvokeInput,
  HostLlmInvokeResult,
  HostMcpInvokeInput,
  HostMcpInvokeResult,
  HostMcpReleaseContextInput,
  HostMcpReleaseContextResult,
  PluginHostPublishInput,
  PluginRuntimeExtensionDeps,
  PluginTurnContext
} from "./runtime-contract.js";
import fs from "node:fs/promises";
import path from "node:path";

export type RuntimeBridgeName = "mcp" | "llm" | "ingest";

export type BasePluginRuntimeOptions = {
  requiredBridges?: RuntimeBridgeName[];
};

export class PluginBridgeError extends Error {
  readonly bridge: RuntimeBridgeName;
  readonly code: string;

  constructor(bridge: RuntimeBridgeName, code: string, message: string) {
    super(message);
    this.name = "PluginBridgeError";
    this.bridge = bridge;
    this.code = code;
  }
}

export abstract class BasePluginRuntime {
  protected readonly pluginId: string;
  private readonly deps: PluginRuntimeExtensionDeps;
  private readonly requiredBridges: RuntimeBridgeName[];
  protected readonly workspace: {
    root: () => string | null;
    path: (...segments: string[]) => string;
    ensureDir: (...segments: string[]) => Promise<string>;
    writeText: (relativePath: string, content: string) => Promise<void>;
    writeJson: (relativePath: string, value: unknown) => Promise<void>;
    readText: (relativePath: string) => Promise<string>;
    readJson: <T>(relativePath: string) => Promise<T>;
    exists: (relativePath: string) => Promise<boolean>;
  };
  protected readonly mcp: {
    contextKey: (ctx: Pick<PluginTurnContext, "sessionId">) => string;
    call: (
      ctx: Pick<PluginTurnContext, "sessionId">,
      input: Omit<HostMcpInvokeInput, "contextKey">
    ) => Promise<Extract<HostMcpInvokeResult, { ok: true }>>;
    callRaw: (input: HostMcpInvokeInput) => Promise<Extract<HostMcpInvokeResult, { ok: true }>>;
    destroy: (
      ctx: Pick<PluginTurnContext, "sessionId">,
      serverId?: string
    ) => Promise<Extract<HostMcpReleaseContextResult, { ok: true }>>;
  };
  protected readonly llm: {
    call: (input: HostLlmInvokeInput) => Promise<Extract<HostLlmInvokeResult, { ok: true }>>;
    text: (input: HostLlmInvokeInput) => Promise<string>;
  };
  protected readonly ingest: {
    call: (input: ExternalUserTurnInput) => Promise<Extract<ExternalUserTurnResult, { ok: true }>>;
  };

  constructor(deps: PluginRuntimeExtensionDeps, options: BasePluginRuntimeOptions = {}) {
    this.pluginId = deps.pluginId;
    this.deps = deps;
    this.requiredBridges = options.requiredBridges ?? [];
    this.workspace = {
      root: () => this.deps.workspaceDir ?? null,
      path: (...segments: string[]) => this.getWorkspacePath(...segments),
      ensureDir: (...segments: string[]) => this.ensureWorkspaceDir(...segments),
      writeText: (relativePath: string, content: string) => this.workspaceWriteText(relativePath, content),
      writeJson: (relativePath: string, value: unknown) => this.workspaceWriteJson(relativePath, value),
      readText: (relativePath: string) => this.workspaceReadText(relativePath),
      readJson: <T>(relativePath: string) => this.workspaceReadJson<T>(relativePath),
      exists: (relativePath: string) => this.workspaceExists(relativePath)
    };
    this.mcp = {
      contextKey: (ctx: Pick<PluginTurnContext, "sessionId">) => `${this.pluginId}:${ctx.sessionId || "default"}`,
      call: (ctx: Pick<PluginTurnContext, "sessionId">, input: Omit<HostMcpInvokeInput, "contextKey">) =>
        this.callMcp({
          ...input,
          contextKey: `${this.pluginId}:${ctx.sessionId || "default"}`
        }),
      callRaw: (input: HostMcpInvokeInput) => this.callMcp(input),
      destroy: (ctx: Pick<PluginTurnContext, "sessionId">, serverId = "playwright") =>
        this.destroyMcpContext({
          serverId,
          contextKey: `${this.pluginId}:${ctx.sessionId || "default"}`
        })
    };
    this.llm = {
      call: (input: HostLlmInvokeInput) => this.callLlm(input),
      text: (input: HostLlmInvokeInput) => this.callLlmText(input)
    };
    this.ingest = {
      call: (input: ExternalUserTurnInput) => this.callIngest(input)
    };
  }

  /**
   * 宿主可能在 `plugin-loading`/`PluginRuntimeProvider` 里对已构造的插件实例执行
   * `Object.assign(extension, { invokeHostMcpTool, ... })`，而构造入参 `deps` 不含这些字段；
   * 桥接探测与调用须同时读取「实例挂载」与 `deps`，否则会出现误报 MISSING_BRIDGE。
   */
  private hostBridgedFns(): Partial<
    Pick<
      PluginRuntimeExtensionDeps,
      | "invokeHostMcpTool"
      | "releaseHostMcpContext"
      | "invokeHostLlm"
      | "ingestExternalUserTurn"
    >
  > {
    return this as unknown as Partial<
      Pick<
        PluginRuntimeExtensionDeps,
        | "invokeHostMcpTool"
        | "releaseHostMcpContext"
        | "invokeHostLlm"
        | "ingestExternalUserTurn"
      >
    >;
  }

  protected hasBridge(bridge: RuntimeBridgeName): boolean {
    const host = this.hostBridgedFns();
    if (bridge === "mcp") {
      return (
        typeof host.invokeHostMcpTool === "function" || typeof this.deps.invokeHostMcpTool === "function"
      );
    }
    if (bridge === "llm") {
      return typeof host.invokeHostLlm === "function" || typeof this.deps.invokeHostLlm === "function";
    }
    return (
      typeof host.ingestExternalUserTurn === "function" ||
      typeof this.deps.ingestExternalUserTurn === "function"
    );
  }

  protected publish(input: PluginHostPublishInput): void {
    this.deps.publish(input);
  }

  protected emitAssistantDelta(ctx: PluginTurnContext, delta: string): void {
    ctx.emitAssistantDelta?.(delta);
  }

  private async callMcp(input: HostMcpInvokeInput): Promise<Extract<HostMcpInvokeResult, { ok: true }>> {
    const fn = this.hostBridgedFns().invokeHostMcpTool ?? this.deps.invokeHostMcpTool;
    if (typeof fn !== "function") {
      throw new PluginBridgeError("mcp", "MISSING_BRIDGE", "invokeHostMcpTool 未注入");
    }
    const r = await fn(input);
    if (!r.ok) {
      throw new PluginBridgeError("mcp", r.code, r.message);
    }
    return r;
  }

  private async destroyMcpContext(
    input: HostMcpReleaseContextInput
  ): Promise<Extract<HostMcpReleaseContextResult, { ok: true }>> {
    const fn = this.hostBridgedFns().releaseHostMcpContext ?? this.deps.releaseHostMcpContext;
    if (typeof fn !== "function") {
      throw new PluginBridgeError("mcp", "MISSING_BRIDGE", "releaseHostMcpContext 未注入");
    }
    const r = await fn(input);
    if (!r.ok) {
      throw new PluginBridgeError("mcp", r.code, r.message);
    }
    return r;
  }

  private async callLlm(input: HostLlmInvokeInput): Promise<Extract<HostLlmInvokeResult, { ok: true }>> {
    const fn = this.hostBridgedFns().invokeHostLlm ?? this.deps.invokeHostLlm;
    if (typeof fn !== "function") {
      throw new PluginBridgeError("llm", "MISSING_BRIDGE", "invokeHostLlm 未注入");
    }
    const r = await fn(input);
    if (!r.ok) {
      throw new PluginBridgeError("llm", r.code, r.message);
    }
    return r;
  }

  private async callLlmText(input: HostLlmInvokeInput): Promise<string> {
    const r = await this.callLlm(input);
    return r.text;
  }

  private async callIngest(input: ExternalUserTurnInput): Promise<Extract<ExternalUserTurnResult, { ok: true }>> {
    const fn = this.hostBridgedFns().ingestExternalUserTurn ?? this.deps.ingestExternalUserTurn;
    if (typeof fn !== "function") {
      throw new PluginBridgeError("ingest", "MISSING_BRIDGE", "ingestExternalUserTurn 未注入");
    }
    const r = await fn(input);
    if (!r.ok) {
      throw new PluginBridgeError("ingest", r.code, r.message);
    }
    return r;
  }

  protected ensureRequiredBridges(): void {
    for (const bridge of this.requiredBridges) {
      if (!this.hasBridge(bridge)) {
        throw new PluginBridgeError(bridge, "MISSING_BRIDGE", `${bridge} bridge 未注入`);
      }
    }
  }

  private getWorkspaceRootOrThrow(): string {
    const root = this.deps.workspaceDir;
    if (typeof root !== "string" || root.trim() === "") {
      throw new PluginBridgeError("ingest", "MISSING_WORKSPACE", "workspaceDir 未注入");
    }
    return root;
  }

  private getWorkspacePath(...segments: string[]): string {
    const root = this.getWorkspaceRootOrThrow();
    const target = path.resolve(root, ...segments);
    const rel = path.relative(root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new PluginBridgeError("ingest", "WORKSPACE_PATH_ESCAPE", "workspace 路径越界");
    }
    return target;
  }

  private async ensureWorkspaceDir(...segments: string[]): Promise<string> {
    const dirPath = this.getWorkspacePath(...segments);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  private async workspaceWriteText(relativePath: string, content: string): Promise<void> {
    const target = this.getWorkspacePath(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }

  private async workspaceWriteJson(relativePath: string, value: unknown): Promise<void> {
    await this.workspaceWriteText(relativePath, JSON.stringify(value, null, 2));
  }

  private async workspaceReadText(relativePath: string): Promise<string> {
    const target = this.getWorkspacePath(relativePath);
    return fs.readFile(target, "utf8");
  }

  private async workspaceReadJson<T>(relativePath: string): Promise<T> {
    const raw = await this.workspaceReadText(relativePath);
    return JSON.parse(raw) as T;
  }

  private async workspaceExists(relativePath: string): Promise<boolean> {
    const target = this.getWorkspacePath(relativePath);
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
