import { randomUUID } from "crypto";
import type { PluginToolLikeStepPayload, PluginTurnContext } from "./runtime-contract.js";

/**
 * 将宿主传入的 `PluginTurnContext` 包装为可注入其它类的「发射器」，
 * 便于在非 `BasePluginRuntime` 子类中复用与基类一致的流式/工具步骤上报语义。
 *
 * @example
 * ```ts
 * const emit = new TurnContextEmitter(context, pluginId);
 * emit.emitToolRunning("my_tool", { foo: 1 });
 * ```
 */
export class TurnContextEmitter {
  readonly context: PluginTurnContext;

  private readonly pluginId: string;
  private readonly rrUID: string;

  constructor(context: PluginTurnContext, pluginId: string) {
    this.context = context;
    this.pluginId = pluginId;
    this.rrUID = randomUUID();
  }

  emitAssistantDelta(delta: string): void {
    this.context.emitAssistantDelta?.(delta);
  }

  emitToolLikeStep(step: PluginToolLikeStepPayload): void {
    const merged: PluginToolLikeStepPayload = {
      ...step,
      input: step.input ?? {},
      output: step.output ?? {}
    };
    const normalized = this.normalizeStep(merged);
    this.context.emitToolLikeStep?.(normalized);
  }

  emitToolRunning(toolName: string, input: Record<string, unknown> = {}): void {
    this.emitToolLikeStep({ toolName, state: "running", input });
  }

  /**
   * 标记工具已完成；`output` 会进入宿主 SSE `tool-output-available`。
   * 仅接受 `(toolName, output)` 两参数，无第三个参数（调用方多传的 payload 会被丢弃）。
   */
  emitToolAvailable(toolName: string, output: Record<string, unknown> = {}): void {
    this.emitToolLikeStep({ toolName, state: "output-available", output });
  }

  emitToolError(toolName: string, errorText: string): void {
    this.emitToolLikeStep({
      toolName,
      state: "output-error",
      errorText,
      output: { content:[{type: "text", text: errorText}],isError: true }
    });
  }

  private normalizeStep(step: PluginToolLikeStepPayload): PluginToolLikeStepPayload {
    const toolName =
      typeof step.toolName === "string" && step.toolName.trim().length > 0
        ? step.toolName.trim()
        : "unknown_tool";
    return {
      ...step,
      toolName,
      stepId:this.buildToolStepId(toolName),
      ...(step.output ? { result: step.output } : {})
    };
  }

  private buildToolStepId(toolName: string): string {
    const normalized = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.pluginId}:${normalized}:${this.rrUID}`;
  }
}
