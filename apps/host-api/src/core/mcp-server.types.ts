export type McpTransport = "stdio" | "http";

export type McpServerStdioConfig = {
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
};

export type McpServerHttpConfig = {
  url: string;
  headers?: Record<string, string>;
  sessionId?: string;
};

export type McpServerStoredConfig = {
  id: string;
  displayName?: string;
  enabled: boolean;
  transport: McpTransport;
  notes?: string;
  stdio?: McpServerStdioConfig | null;
  http?: McpServerHttpConfig | null;
};

export type McpToolSnapshot = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpServerStatusSnapshot = {
  lastProbeAt: string | null;
  ok: boolean;
  errorMessage?: string;
  tools: McpToolSnapshot[];
};
