import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchMcpServerDetail,
  saveMcpServer,
  type McpServerStoredConfig
} from "@/lib/api/mcp.api";

const NEW_ID = "__new__";

type SimpleMcpServerEntry = {
  command?: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  sessionId?: string;
  enabled?: boolean;
  displayName?: string;
  notes?: string;
};

type SimpleMcpServerMap = Record<string, SimpleMcpServerEntry>;

const DEFAULT_NEW_SERVER: SimpleMcpServerMap = {
  playwright: {
    command: "npx",
    args: ["@playwright/mcp@latest"]
  }
};

function prettyJson(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

export function useMcpServerEditor(serverId: string | undefined) {
  const isNew = !serverId || serverId === NEW_ID;
  const [text, setText] = useState(prettyJson(DEFAULT_NEW_SERVER));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        setText(prettyJson(DEFAULT_NEW_SERVER));
      } else {
        const detail = await fetchMcpServerDetail(serverId);
        setText(prettyJson(toSimpleMap(detail.config)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isNew, serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedDraft = useMemo(() => {
    try {
      return { value: JSON.parse(text) as unknown, error: null as string | null };
    } catch (e) {
      return {
        value: null,
        error: e instanceof Error ? e.message : "JSON 解析失败"
      };
    }
  }, [text]);

  const save = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (parsedDraft.error || !parsedDraft.value) {
      setError(parsedDraft.error ?? "JSON 无效");
      return null;
    }
    setSaving(true);
    try {
      const config = parseEditorJsonToStoredConfig(parsedDraft.value, serverId);
      const saved = await saveMcpServer(config);
      setNotice("MCP 配置已保存");
      setText(prettyJson(toSimpleMap(saved.config)));
      return saved.config.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [parsedDraft.error, parsedDraft.value]);

  return {
    text,
    setText,
    loading,
    saving,
    error,
    notice,
    jsonError: parsedDraft.error,
    load,
    save,
    isNew
  };
}

function toSimpleMap(config: McpServerStoredConfig): SimpleMcpServerMap {
  if (config.transport === "http") {
    const entry: SimpleMcpServerEntry = {
      url: config.http?.url ?? ""
    };
    if (config.http?.headers && Object.keys(config.http.headers).length > 0) {
      entry.headers = config.http.headers;
    }
    if (config.http?.sessionId) {
      entry.sessionId = config.http.sessionId;
    }
    if (config.enabled !== true) {
      entry.enabled = config.enabled;
    }
    if (config.displayName && config.displayName !== config.id) {
      entry.displayName = config.displayName;
    }
    if (config.notes && config.notes.trim()) {
      entry.notes = config.notes;
    }
    return {
      [config.id]: entry
    };
  }
  const entry: SimpleMcpServerEntry = {
    command: config.stdio?.command ?? "",
    args: config.stdio?.args ?? []
  };
  if (config.stdio?.cwd !== null && config.stdio?.cwd !== undefined) {
    entry.cwd = config.stdio.cwd;
  }
  if (config.stdio?.env && Object.keys(config.stdio.env).length > 0) {
    entry.env = config.stdio.env;
  }
  if (config.enabled !== true) {
    entry.enabled = config.enabled;
  }
  if (config.displayName && config.displayName !== config.id) {
    entry.displayName = config.displayName;
  }
  if (config.notes && config.notes.trim()) {
    entry.notes = config.notes;
  }
  return {
    [config.id]: entry
  };
}

function parseEditorJsonToStoredConfig(input: unknown, currentServerId?: string): McpServerStoredConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("JSON 必须是对象");
  }
  const obj = input as Record<string, unknown>;

  // 兼容旧格式（内部配置）
  if (typeof obj.id === "string" && typeof obj.transport === "string") {
    return obj as McpServerStoredConfig;
  }

  // 兼容 {"mcpServers": {...}} 或直接 {...}
  const maybeMap = (obj.mcpServers ?? obj) as unknown;
  if (!maybeMap || typeof maybeMap !== "object" || Array.isArray(maybeMap)) {
    throw new Error("请使用 {\"playwright\": {...}} 或 {\"mcpServers\": {...}}");
  }
  const map = maybeMap as Record<string, unknown>;
  const entries = Object.entries(map);
  if (entries.length !== 1) {
    throw new Error("当前编辑页一次仅支持 1 个 server，请仅保留一个键");
  }
  const [id, rawEntry] = entries[0];
  if (!id) {
    throw new Error("server id 不能为空");
  }
  if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
    throw new Error("server 配置必须是对象");
  }
  if (currentServerId && currentServerId !== NEW_ID && currentServerId !== id) {
    throw new Error(`当前在编辑 ${currentServerId}，请保持键名一致，或从 New 新建`);
  }
  const e = rawEntry as Record<string, unknown>;
  const enabled = typeof e.enabled === "boolean" ? e.enabled : true;
  const displayName = typeof e.displayName === "string" ? e.displayName : id;
  const notes = typeof e.notes === "string" ? e.notes : "";

  const hasUrl = typeof e.url === "string" && e.url.trim().length > 0;
  if (hasUrl) {
    return {
      id,
      displayName,
      enabled,
      transport: "http",
      notes,
      stdio: null,
      http: {
        url: String(e.url),
        headers: asStringRecord(e.headers),
        sessionId: typeof e.sessionId === "string" ? e.sessionId : undefined
      }
    };
  }

  const command = typeof e.command === "string" ? e.command.trim() : "";
  if (!command) {
    throw new Error("stdio 模式需提供 command（例如 npx）");
  }
  const args = Array.isArray(e.args) ? e.args.filter((v): v is string => typeof v === "string") : [];
  return {
    id,
    displayName,
    enabled,
    transport: "stdio",
    notes,
    stdio: {
      command,
      args,
      cwd: typeof e.cwd === "string" || e.cwd === null ? (e.cwd ?? null) : null,
      env: asStringRecord(e.env)
    },
    http: null
  };
}

function asStringRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") {
      out[k] = val;
    }
  }
  return out;
}
