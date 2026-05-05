import type { PluginRuntimeExtensionDeps } from "./runtime-contract.js";

const MISSING_INVOKE_BODY =
  "invokeHostLlm 未注入；请使用已注册宿主 LLM 桥的 host-api，并在 plugin.json 声明 capabilities.llm。";

export type GuardInvokeHostLlmOk = {
  ok: true;
  invoke: NonNullable<PluginRuntimeExtensionDeps["invokeHostLlm"]>;
};

export type GuardInvokeHostLlmFail = {
  ok: false;
  message: string;
};

export type GuardInvokeHostLlmResult = GuardInvokeHostLlmOk | GuardInvokeHostLlmFail;

/**
 * 在使用 `invokeHostLlm` 前调用，与 `guardInvokeHostMcpTool` 对称。
 */
export function guardInvokeHostLlm(options: {
  invokeHostLlm?: PluginRuntimeExtensionDeps["invokeHostLlm"];
  label?: string;
}): GuardInvokeHostLlmResult {
  const invoke = options.invokeHostLlm;
  if (typeof invoke !== "function") {
    const tag = options.label?.trim() ? `[${options.label.trim()}] ` : "";
    return { ok: false, message: `${tag}${MISSING_INVOKE_BODY}` };
  }
  return { ok: true, invoke };
}
