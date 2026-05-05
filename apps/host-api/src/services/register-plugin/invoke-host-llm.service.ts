import type { HostLlmInvokeInput, HostLlmInvokeResult } from "@wclaw/plugin-sdk";
import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { getLlmConfig } from "../../repositories/llm-config.repository.js";
import { generateWithConfiguredLlm } from "../llm/llm-runtime.service.js";

export type CreateInvokeHostLlmForPluginOptions = {
  pluginId: string;
  getPluginRuntime: () => PluginRuntimePort;
};

/**
 * 宿主 LLM 窄接口：`invokeHostLlm({ messages, model? })`，与控制台 LLM 配置同源；
 * 仅当 `plugin.json` 声明 `capabilities.llm === true` 时注入。
 */
export function createInvokeHostLlmForPlugin(
  options: CreateInvokeHostLlmForPluginOptions
): (input: HostLlmInvokeInput) => Promise<HostLlmInvokeResult> {
  return async (input: HostLlmInvokeInput): Promise<HostLlmInvokeResult> => {
    const row = await options.getPluginRuntime().plugin(options.pluginId);
    const manifest = row?.manifest;
    if (!manifest) {
      return {
        ok: false,
        code: ERROR_CODES.PLUGIN_NOT_FOUND,
        message: `plugin not found: ${options.pluginId}`
      };
    }
    if (manifest.capabilities?.llm !== true) {
      return {
        ok: false,
        code: ERROR_CODES.INVALID_REQUEST,
        message: "[llm] 当前插件未声明 capabilities.llm，禁止使用 invokeHostLlm。"
      };
    }

    const err = validateHostLlmInput(input);
    if (err) {
      return { ok: false, code: ERROR_CODES.INVALID_REQUEST, message: err };
    }

    try {
      const result = await generateWithConfiguredLlm({
        messages: input.messages,
        modelOverride: input.model
      });
      const cfg = getLlmConfig();
      let resolvedModel: string | undefined;
      if (typeof input.model === "string" && input.model.trim()) {
        resolvedModel = input.model.trim();
      } else {
        const m = cfg.model;
        if (typeof m === "string" && m.trim()) resolvedModel = m.trim();
      }
      return { ok: true, text: result.text, ...(resolvedModel ? { model: resolvedModel } : {}) };
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, code: ERROR_CODES.LLM_UPSTREAM_ERROR, message: msg };
    }
  };
}

function validateHostLlmInput(input: HostLlmInvokeInput): string | null {
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return "[llm] messages 必须为非空数组。";
  }
  const roles = new Set(["system", "user", "assistant"]);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return `[llm] messages[${i}] 必须是对象。`;
    }
    if (!roles.has(m.role)) {
      return `[llm] messages[${i}].role 须为 system | user | assistant。`;
    }
    if (typeof m.content !== "string") {
      return `[llm] messages[${i}].content 须为 string。`;
    }
  }
  return null;
}
