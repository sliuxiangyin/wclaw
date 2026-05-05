import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerStoredConfig, McpToolSnapshot } from "../../core/mcp-server.types.js";

export class McpSdkClientRunner {
  private readonly clientInfo: { name: string; version: string };
  private readonly clientPool = new Map<string, { client: Client; transport: StdioClientTransport | StreamableHTTPClientTransport }>();

  constructor(clientInfo = { name: "wclaw-host-mcp-gateway", version: "0.1.0" }) {
    this.clientInfo = clientInfo;
  }

  private buildTransport(config: McpServerStoredConfig): StdioClientTransport | StreamableHTTPClientTransport {
    if (config.transport === "stdio") {
      const s = config.stdio;
      if (!s) {
        throw new Error("stdio transport missing stdio block");
      }
      return new StdioClientTransport({
        command: s.command,
        args: s.args,
        cwd: s.cwd ?? undefined,
        env: s.env,
        stderr: "ignore"
      });
    }
    const h = config.http;
    if (!h) {
      throw new Error("http transport missing http block");
    }
    const url = new URL(h.url);
    const headers = h.headers ?? undefined;
    const requestInit: RequestInit | undefined =
      headers && Object.keys(headers).length > 0 ? { headers } : undefined;
    return new StreamableHTTPClientTransport(url, {
      sessionId: h.sessionId,
      requestInit,
      reconnectionOptions: {
        maxReconnectionDelay: 2000,
        initialReconnectionDelay: 200,
        reconnectionDelayGrowFactor: 1.2,
        maxRetries: 0
      }
    });
  }

  async withClient<T>(config: McpServerStoredConfig, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client(this.clientInfo, {});
    const transport = this.buildTransport(config);
    try {
      await client.connect(transport);
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async withPersistentClient<T>(
    serverId: string,
    contextKey: string,
    config: McpServerStoredConfig,
    fn: (client: Client) => Promise<T>
  ): Promise<T> {
    const poolKey = `${serverId}::${contextKey}`;
    let entry = this.clientPool.get(poolKey);
    if (!entry) {
      const client = new Client(this.clientInfo, {});
      const transport = this.buildTransport(config);
      await client.connect(transport);
      entry = { client, transport };
      this.clientPool.set(poolKey, entry);
    }
    try {
      return await fn(entry.client);
    } catch (error) {
      await entry.client.close().catch(() => undefined);
      this.clientPool.delete(poolKey);
      throw error;
    }
  }

  async releasePersistentClient(serverId: string, contextKey: string): Promise<boolean> {
    const poolKey = `${serverId}::${contextKey}`;
    const entry = this.clientPool.get(poolKey);
    if (!entry) return false;
    await entry.client.close().catch(() => undefined);
    this.clientPool.delete(poolKey);
    return true;
  }

  async listAllTools(client: Client): Promise<McpToolSnapshot[]> {
    const acc: McpToolSnapshot[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      for (const t of page.tools) {
        acc.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return acc;
  }
}
