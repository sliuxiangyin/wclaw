import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import type {
  McpServerStatusSnapshot,
  McpServerStoredConfig,
  McpTransport
} from "../../core/mcp-server.types.js";
import type { McpServerRow } from "../../repositories/mcp-server.repository.js";
import { McpServerRepository } from "../../repositories/mcp-server.repository.js";
import { McpSdkClientRunner } from "./mcp-sdk-client-runner.js";
import { McpServerConfigParser } from "./mcp-server-config.parser.js";

export type McpServerSummaryDto = {
  id: string;
  displayName?: string;
  enabled: boolean;
  transport: McpTransport;
  status: McpServerStatusSnapshot;
  updated_at: string;
};

export type McpServerDetailDto = {
  id: string;
  config: McpServerStoredConfig;
  status: McpServerStatusSnapshot;
  updated_at: string;
};

export type McpCatalogDto = {
  servers: Array<{
    id: string;
    displayName?: string;
    enabled: boolean;
    transport: McpServerStoredConfig["transport"];
    status: Pick<McpServerStatusSnapshot, "ok" | "lastProbeAt" | "errorMessage"> & {
      toolCount: number;
    };
  }>;
  tools: Array<{ toolId: string; serverId: string; name: string; description?: string }>;
};

export class McpGatewayService {
  private readonly serverInvokeLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: McpServerRepository,
    private readonly runner: McpSdkClientRunner,
    private readonly configParser: McpServerConfigParser
  ) {}

  private shouldSerializeInvoke(serverId: string): boolean {
    return serverId === "playwright";
  }

  private async runWithServerLock<T>(serverId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.serverInvokeLocks.get(serverId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.serverInvokeLocks.set(serverId, prev.then(() => current));
    await prev;
    try {
      return await task();
    } finally {
      release();
      const latest = this.serverInvokeLocks.get(serverId);
      if (latest === current) {
        this.serverInvokeLocks.delete(serverId);
      }
    }
  }

  splitQualifiedToolId(toolId: string): { serverId: string; toolName: string } {
    const idx = toolId.indexOf("/");
    if (idx <= 0 || idx === toolId.length - 1) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "toolId must be serverId/toolName", 400);
    }
    return { serverId: toolId.slice(0, idx), toolName: toolId.slice(idx + 1) };
  }

  listMcpServerSummaries(): McpServerSummaryDto[] {
    return this.repo.list().map((r) => ({
      id: r.id,
      displayName: r.config.displayName,
      enabled: r.config.enabled,
      transport: r.config.transport,
      status: r.status,
      updated_at: r.updated_at
    }));
  }

  getMcpServerDetail(id: string): McpServerDetailDto {
    const r = this.repo.getById(id);
    if (!r) {
      throw new AppError(ERROR_CODES.MCP_SERVER_NOT_FOUND, `mcp server not found: ${id}`, 404);
    }
    return {
      id: r.id,
      config: r.config,
      status: r.status,
      updated_at: r.updated_at
    };
  }

  putMcpServer(body: unknown, pathId: string): McpServerRow {
    const config = this.configParser.parse(body);
    if (config.id !== pathId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "path id must match body.id", 400);
    }
    return this.repo.upsertConfig(config);
  }

  removeMcpServer(id: string): void {
    if (!this.repo.deleteById(id)) {
      throw new AppError(ERROR_CODES.MCP_SERVER_NOT_FOUND, `mcp server not found: ${id}`, 404);
    }
  }

  async probeMcpServer(id: string): Promise<McpServerStatusSnapshot> {
    const row = this.repo.getById(id);
    if (!row) {
      throw new AppError(ERROR_CODES.MCP_SERVER_NOT_FOUND, `mcp server not found: ${id}`, 404);
    }
    const { config } = row;
    if (!config.enabled) {
      throw new AppError(ERROR_CODES.MCP_PROBE_FAILED, "server is disabled; enable before probe", 400);
    }

    try {
      const tools = await this.runner.withClient(config, async (client) => this.runner.listAllTools(client));
      const status: McpServerStatusSnapshot = {
        lastProbeAt: new Date().toISOString(),
        ok: true,
        tools
      };
      this.repo.updateStatus(id, status);
      return status;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status: McpServerStatusSnapshot = {
        lastProbeAt: new Date().toISOString(),
        ok: false,
        errorMessage: msg,
        tools: []
      };
      this.repo.updateStatus(id, status);
      throw new AppError(ERROR_CODES.MCP_PROBE_FAILED, msg, 502);
    }
  }

  buildCatalog(): McpCatalogDto {
    const rows = this.repo.list();
    const servers: McpCatalogDto["servers"] = [];
    const tools: McpCatalogDto["tools"] = [];
    for (const r of rows) {
      if (!r.config.enabled) {
        servers.push({
          id: r.id,
          displayName: r.config.displayName,
          enabled: false,
          transport: r.config.transport,
          status: {
            ok: false,
            lastProbeAt: r.status.lastProbeAt,
            errorMessage: "disabled",
            toolCount: 0
          }
        });
        continue;
      }
      const toolCount = r.status.ok ? r.status.tools.length : 0;
      servers.push({
        id: r.id,
        displayName: r.config.displayName,
        enabled: true,
        transport: r.config.transport,
        status: {
          ok: r.status.ok,
          lastProbeAt: r.status.lastProbeAt,
          errorMessage: r.status.errorMessage,
          toolCount
        }
      });
      if (r.status.ok) {
        for (const t of r.status.tools) {
          tools.push({
            toolId: `${r.id}/${t.name}`,
            serverId: r.id,
            name: t.name,
            description: t.description
          });
        }
      }
    }
    return { servers, tools };
  }

  getToolSchemaFromSnapshot(serverId: string, toolName: string): Record<string, unknown> {
    const row = this.repo.getById(serverId);
    if (!row) {
      throw new AppError(ERROR_CODES.MCP_TOOL_NOT_FOUND, "server not found", 404);
    }
    const tool = row.status.tools.find((t) => t.name === toolName);
    if (!tool || !tool.inputSchema || typeof tool.inputSchema !== "object") {
      throw new AppError(ERROR_CODES.MCP_TOOL_NOT_FOUND, "tool schema not available; probe first", 404);
    }
    return tool.inputSchema;
  }

  async invokeTool(params: {
    toolId: string;
    arguments: Record<string, unknown>;
    traceId?: string | null;
    contextKey?: string;
  }): Promise<unknown> {
    const { serverId, toolName } = this.splitQualifiedToolId(params.toolId);
    const row = this.repo.getById(serverId);
    if (!row) {
      throw new AppError(ERROR_CODES.MCP_SERVER_NOT_FOUND, `mcp server not found: ${serverId}`, 404);
    }
    if (!row.config.enabled) {
      throw new AppError(ERROR_CODES.MCP_INVOKE_FAILED, "server is disabled", 400);
    }
    const invoke = async () => {
      const contextKey = String(params.contextKey || "global");
      return this.runner.withPersistentClient(serverId, contextKey, row.config, async (client) => {
        const result = await client.callTool(
          { name: toolName, arguments: params.arguments ?? {} },
          undefined,
          {
            timeout: 120_000
          }
        );
        return result;
      });
    };
    try {
      if (this.shouldSerializeInvoke(serverId)) {
        return await this.runWithServerLock(serverId, invoke);
      }
      return await invoke();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof AppError) {
        throw e;
      }
      throw new AppError(ERROR_CODES.MCP_INVOKE_FAILED, msg, 502);
    }
  }

  async releaseContext(params: { serverId: string; contextKey: string }): Promise<boolean> {
    return this.runner.releasePersistentClient(params.serverId, params.contextKey);
  }

  validateToolArguments(toolId: string, args: unknown): Record<string, unknown> {
    const parsed = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
    this.splitQualifiedToolId(toolId);
    return parsed as Record<string, unknown>;
  }
}

export function createMcpGatewayService(): McpGatewayService {
  return new McpGatewayService(new McpServerRepository(), new McpSdkClientRunner(), new McpServerConfigParser());
}
