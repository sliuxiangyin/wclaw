import type { PluginRuntimeExtensionDeps } from "./runtime-contract.js";

const MISSING_INVOKE_BODY =
  "invokeHostMcpTool 未注入；请使用已注册 MCP 桥的 host-api，并在 plugin.json 配置 mcp.allowedServers。";

export type GuardInvokeHostMcpToolOk = {
  ok: true;
  invoke: NonNullable<PluginRuntimeExtensionDeps["invokeHostMcpTool"]>;
};

export type GuardInvokeHostMcpToolFail = {
  ok: false;
  /** 可直接塞进 `toTurnResult(message)` 或拼到命令插件字符串前缀后 */
  message: string;
};

export type GuardInvokeHostMcpToolResult = GuardInvokeHostMcpToolOk | GuardInvokeHostMcpToolFail;

/**
 * 在使用 `invokeHostMcpTool` 前调用，避免各插件复制 `typeof … === "function"` 与长文案。
 *
 * @param options.label 可选，如插件 `pluginId`，会拼成 `[label] …` 前缀。
 */
export function guardInvokeHostMcpTool(options: {
  invokeHostMcpTool?: PluginRuntimeExtensionDeps["invokeHostMcpTool"];
  label?: string;
}): GuardInvokeHostMcpToolResult {
  const invoke = options.invokeHostMcpTool;
  if (typeof invoke !== "function") {
    const tag = options.label?.trim() ? `[${options.label.trim()}] ` : "";
    return { ok: false, message: `${tag}${MISSING_INVOKE_BODY}` };
  }
  return { ok: true, invoke };
}
