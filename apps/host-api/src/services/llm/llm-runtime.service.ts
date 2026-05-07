import { generateText, streamText, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import { getLlmConfig } from "../../repositories/llm-config.repository.js";

type LlmInputMessage = { role: "system" | "user" | "assistant"; content: string };

export async function generateWithConfiguredLlm(input: {
  messages: LlmInputMessage[];
  modelOverride?: string;
}) {
  const runtime = buildLlmRuntime(input.modelOverride);
  const messages = runtime.toModelMessages(input.messages);
  try {
    const result = await generateText({
      model: runtime.model,
      messages,
      allowSystemInMessages: true,
      ...(typeof runtime.temperature === "number" ? { temperature: runtime.temperature } : {}),
      ...(typeof runtime.maxTokens === "number" ? { maxTokens: runtime.maxTokens } : {})
    });

    const text = result.text.trim();
    return { text: text.length > 0 ? text : "(empty llm response)" };
  } catch (error) {
    throw new AppError(ERROR_CODES.LLM_UPSTREAM_ERROR, normalizeLlmErrorMessage(error), 502);
  }
}

export async function streamWithConfiguredLlm(input: {
  messages: LlmInputMessage[];
  modelOverride?: string;
  onTextDelta?: (delta: string) => void;
}) {
  const runtime = buildLlmRuntime(input.modelOverride);
  const messages = runtime.toModelMessages(input.messages);

  try {
    const result = streamText({
      model: runtime.model,
      messages,
      allowSystemInMessages: true,
      ...(typeof runtime.temperature === "number" ? { temperature: runtime.temperature } : {}),
      ...(typeof runtime.maxTokens === "number" ? { maxTokens: runtime.maxTokens } : {})
    });

    let fullText = "";
    for await (const delta of result.textStream) {
      fullText += delta;
      input.onTextDelta?.(delta);
    }

    const text = fullText.trim();
    return { text: text.length > 0 ? text : "(empty llm response)" };
  } catch (error) {
    throw new AppError(ERROR_CODES.LLM_UPSTREAM_ERROR, normalizeLlmErrorMessage(error), 502);
  }
}

function buildLlmRuntime(modelOverride?: string) {
  const cfg = getLlmConfig();
  const modelName = readString(cfg, ["model"], modelOverride ?? "gpt-4o-mini");
  const baseURL = readOptionalString(cfg, ["baseURL", "baseUrl", "endpoint"]);
  const apiKey = readOptionalString(cfg, ["apiKey", "api_key"]);
  const systemPrompt = readOptionalString(cfg, ["systemPrompt", "system"]);
  const temperature = readOptionalNumber(cfg, ["temperature"]);
  const maxTokens = readOptionalNumber(cfg, ["maxTokens", "max_tokens"]);

  if (!apiKey) {
    throw new AppError(ERROR_CODES.LLM_API_KEY_MISSING, "LLM apiKey 未配置，请先在 LLM 设置中保存 apiKey。", 400);
  }

  const provider = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {})
  });

  return {
    model: provider.chat(modelName),
    temperature,
    maxTokens,
    toModelMessages(inputMessages: LlmInputMessage[]): ModelMessage[] {
      const mappedMessages: ModelMessage[] = inputMessages.map((m) => ({
        role: m.role,
        content: m.content
      }));
      return systemPrompt ? [{ role: "system", content: systemPrompt }, ...mappedMessages] : mappedMessages;
    }
  };
}

function readString(cfg: Record<string, unknown>, keys: string[], fallback: string): string {
  const value = readOptionalString(cfg, keys);
  return value ?? fallback;
}

function readOptionalString(cfg: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = cfg[key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return undefined;
}

function readOptionalNumber(cfg: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = cfg[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function normalizeLlmErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.message) return `LLM 调用失败: ${error.message}`;
  return "LLM 调用失败，请检查模型配置与网络连通性。";
}
