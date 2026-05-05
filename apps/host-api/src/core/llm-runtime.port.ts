/**
 * LLM 调用端口：由 `providers/llm-runtime-provider` 实现，`services/ai-chat` 仅依赖本类型（不得 import providers）。
 */

export type LlmInputMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmRuntimePort = {
  /**
   * 使用宿主已保存的 LLM 配置（含可选 systemPrompt）执行一次非流式补全。
   */
  generateWithConfiguredLlm(input: {
    messages: LlmInputMessage[];
    modelOverride?: string;
  }): Promise<{ text: string }>;

  /**
   * 使用宿主已保存的 LLM 配置执行流式补全；将增量写入 `onTextDelta` 并返回拼接后的全文。
   */
  streamWithConfiguredLlm(input: {
    messages: LlmInputMessage[];
    modelOverride?: string;
    onTextDelta?: (delta: string) => void;
  }): Promise<{ text: string }>;
};
