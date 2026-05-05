import { db } from "../core/db.js";
import type { McpServerStatusSnapshot, McpServerStoredConfig } from "../core/mcp-server.types.js";

export type McpServerRow = {
  id: string;
  config: McpServerStoredConfig;
  status: McpServerStatusSnapshot;
  updated_at: string;
};

export class McpServerRepository {
  private readonly listStmt = db.prepare(`
    SELECT id, config_json, status_json, updated_at FROM mcp_servers ORDER BY id ASC
  `);

  private readonly getStmt = db.prepare(`
    SELECT id, config_json, status_json, updated_at FROM mcp_servers WHERE id = ?
  `);

  private readonly upsertStmt = db.prepare(`
    INSERT INTO mcp_servers (id, config_json, status_json, updated_at)
    VALUES (@id, @config_json, @status_json, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      config_json = excluded.config_json,
      status_json = excluded.status_json,
      updated_at = excluded.updated_at
  `);

  private readonly deleteStmt = db.prepare(`DELETE FROM mcp_servers WHERE id = ?`);

  private readonly updateStatusStmt = db.prepare(`
    UPDATE mcp_servers SET status_json = @status_json, updated_at = @updated_at WHERE id = @id
  `);

  private parseRow(r: {
    id: string;
    config_json: string;
    status_json: string;
    updated_at: string;
  }): McpServerRow {
    return {
      id: r.id,
      config: JSON.parse(r.config_json) as McpServerStoredConfig,
      status: JSON.parse(r.status_json) as McpServerStatusSnapshot,
      updated_at: r.updated_at
    };
  }

  initialStatusSnapshot(): McpServerStatusSnapshot {
    return {
      lastProbeAt: null,
      ok: false,
      errorMessage: "尚未探测",
      tools: []
    };
  }

  list(): McpServerRow[] {
    const rows = this.listStmt.all() as Array<{
      id: string;
      config_json: string;
      status_json: string;
      updated_at: string;
    }>;
    return rows.map((r) => this.parseRow(r));
  }

  getById(id: string): McpServerRow | undefined {
    const r = this.getStmt.get(id) as
      | {
          id: string;
          config_json: string;
          status_json: string;
          updated_at: string;
        }
      | undefined;
    if (!r) {
      return undefined;
    }
    return this.parseRow(r);
  }

  upsertFull(config: McpServerStoredConfig, status: McpServerStatusSnapshot): McpServerRow {
    const now = new Date().toISOString();
    this.upsertStmt.run({
      id: config.id,
      config_json: JSON.stringify(config),
      status_json: JSON.stringify(status),
      updated_at: now
    });
    const row = this.getById(config.id);
    if (!row) {
      throw new Error("mcp_servers upsert readback failed");
    }
    return row;
  }

  /** 新建或替换配置：新行用初始探测状态；已有行清空 tools 并要求重新探测 */
  upsertConfig(config: McpServerStoredConfig): McpServerRow {
    const existing = this.getById(config.id);
    if (!existing) {
      return this.upsertFull(config, this.initialStatusSnapshot());
    }
    const mergedStatus: McpServerStatusSnapshot = {
      ...existing.status,
      lastProbeAt: existing.status.lastProbeAt,
      ok: false,
      errorMessage: "配置已更新，请重新探测",
      tools: []
    };
    return this.upsertFull(config, mergedStatus);
  }

  updateStatus(id: string, status: McpServerStatusSnapshot): void {
    const now = new Date().toISOString();
    this.updateStatusStmt.run({
      id,
      status_json: JSON.stringify(status),
      updated_at: now
    });
  }

  deleteById(id: string): boolean {
    const info = this.deleteStmt.run(id);
    return info.changes > 0;
  }
}
