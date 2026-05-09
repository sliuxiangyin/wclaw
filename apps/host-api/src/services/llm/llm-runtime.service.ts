import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";
import { getLlmConfig } from "../../repositories/llm-config.repository.js";

type LlmInputMessage = { role: "system" | "user" | "assistant"; content: string };

function logLlmRequestMessages(kind: "generate" | "stream", input: {
  messages: LlmInputMessage[];
  modelOverride?: string;
  tools?: ToolSet;
  toolPolicy?: "auto" | "none";
}): void {
  // 便于排查上下文污染：打印每次 LLM 请求的消息窗口（完整内容）。
  console.info("[llm-request]", {
    kind,
    modelOverride: input.modelOverride ?? null,
    toolPolicy: input.toolPolicy ?? "auto",
    hasTools: Boolean(input.tools && Object.keys(input.tools).length > 0),
    messageCount: input.messages.length,
    messages: input.messages
  });
}

function logLlmResolvedMessages(kind: "generate" | "stream" | "stream-ui", input: {
  modelOverride?: string;
  toolPolicy?: "auto" | "none";
  tools?: ToolSet;
  messages: ModelMessage[];
}): void {
  const messageContents = input.messages.map((m, index) => ({
    index,
    role: m.role,
    contentText:JSON.stringify(m),
    contentRaw: safeJsonStringify((m as { content?: unknown }).content)
  }));
  console.info("[llm-send]", {
    kind,
    modelOverride: input.modelOverride ?? null,
    toolPolicy: input.toolPolicy ?? "auto",
    hasTools: Boolean(input.tools && Object.keys(input.tools).length > 0),
    messageCount: input.messages.length,
    messages: input.messages,
    messageContents
  });
}

function extractModelMessageContentText(message: ModelMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return String(part);
      const rec = part as Record<string, unknown>;
      if (typeof rec.text === "string") return rec.text;
      if (typeof rec.content === "string") return rec.content;
      if (rec.type === "tool-call" || rec.type === "tool-result") {
        return safeJsonStringify(rec);
      }
      return safeJsonStringify(rec);
    })
    .join("\n");
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...(truncated)`;
}

export async function generateWithConfiguredLlm(input: {
  messages: LlmInputMessage[];
  modelOverride?: string;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  toolPolicy?: "auto" | "none";
}) {
  logLlmRequestMessages("generate", input);
  const runtime = buildLlmRuntime(input.modelOverride);
  const messages = runtime.toModelMessages(input.messages);
  const hasTools = input.toolPolicy !== "none" && Boolean(input.tools && Object.keys(input.tools).length > 0);
  logLlmResolvedMessages("generate", {
    modelOverride: input.modelOverride,
    toolPolicy: input.toolPolicy,
    tools: input.tools,
    messages
  });
  try {
    const result = await generateText({
      model: runtime.model,
      messages,
      allowSystemInMessages: true,
      abortSignal: input.abortSignal,
      stopWhen: stepCountIs(runtime.maxSteps),
      ...(hasTools ? { tools: input.tools } : {}),
      ...(!hasTools ? { toolChoice: "none" as const } : {}),
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
  onChunk?: (chunk: Record<string, unknown> & { type: string }) => void;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  toolPolicy?: "auto" | "none";
}) {
  logLlmRequestMessages("stream", input);
  const runtime = buildLlmRuntime(input.modelOverride);
  const messages = runtime.toModelMessages(input.messages);
  const hasTools = input.toolPolicy !== "none" && Boolean(input.tools && Object.keys(input.tools).length > 0);
  logLlmResolvedMessages("stream", {
    modelOverride: input.modelOverride,
    toolPolicy: input.toolPolicy,
    tools: input.tools,
    messages
  });
  try {
    const result = streamText({
      model: runtime.model,
      messages,
      allowSystemInMessages: true,
      abortSignal: input.abortSignal,
      stopWhen: stepCountIs(runtime.maxSteps),
      ...(hasTools ? { tools: input.tools } : {}),
      ...(!hasTools ? { toolChoice: "none" as const } : {}),
      ...(typeof runtime.temperature === "number" ? { temperature: runtime.temperature } : {}),
      ...(typeof runtime.maxTokens === "number" ? { maxTokens: runtime.maxTokens } : {})
    });

    let fullText = "";
    for await (const chunk of result.toUIMessageStream({ sendSources: true })) {
      const raw = chunk as UIMessageChunk;
      if (raw.type === "text-delta" && typeof raw.delta === "string" && raw.delta.length > 0) {
        fullText += raw.delta;
        input.onTextDelta?.(raw.delta);
      }
      input.onChunk?.(chunk as Record<string, unknown> & { type: string });
    }

    return { text: fullText.trim() };
  } catch (error) {
    throw new AppError(ERROR_CODES.LLM_UPSTREAM_ERROR, normalizeLlmErrorMessage(error), 502);
  }
}

export async function streamUiMessagesWithConfiguredLlm(input: {
  messages: UIMessage[];
  system?: string;
  modelOverride?: string;
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  toolPolicy?: "auto" | "none";
}) {
  const runtime = buildLlmRuntime(input.modelOverride);
  const hasTools = input.toolPolicy !== "none" && Boolean(input.tools && Object.keys(input.tools).length > 0);
  try {
    const system = [runtime.systemPrompt, input.system]
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
    const messages = await convertToModelMessages(input.messages);
    logLlmResolvedMessages("stream-ui", {
      modelOverride: input.modelOverride,
      toolPolicy: input.toolPolicy,
      tools: input.tools,
      messages
    });
    return streamText({
      model: runtime.model,
      ...(system ? { system } : {}),
      messages,
      allowSystemInMessages: true,
      abortSignal: input.abortSignal,
      stopWhen: stepCountIs(runtime.maxSteps),
      ...(hasTools ? { tools: input.tools } : {}),
      ...(!hasTools ? { toolChoice: "none" as const } : {}),
      ...(typeof runtime.temperature === "number" ? { temperature: runtime.temperature } : {}),
      ...(typeof runtime.maxTokens === "number" ? { maxTokens: runtime.maxTokens } : {})
    });
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
  const maxStepsRaw = readOptionalNumber(cfg, ["maxSteps", "max_steps"]);
  const maxSteps = Number.isFinite(maxStepsRaw) ? Math.max(1, Math.floor(maxStepsRaw!)) : 8;

  if (!apiKey) {
    throw new AppError(ERROR_CODES.LLM_API_KEY_MISSING, "LLM apiKey 未配置，请先在 LLM 设置中保存 apiKey。", 400);
  }

  const provider = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {})
  });

  return {
    model: provider.chat(modelName),
    systemPrompt,
    temperature,
    maxTokens,
    maxSteps,
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
