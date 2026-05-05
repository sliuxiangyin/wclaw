// 宿主审计：会话相关结构化事件写入 chat_events
import { appendChatEvent } from "../../repositories/chat-event.repository.js";
// 读取/默认化当前 pluginId+sessionId 的编排模式（normal / isolated）
import { getChatSessionState } from "../../repositories/chat-session.repository.js";
// 会话消息正文持久化（user / assistant 行）
import { appendChatMessage } from "../../repositories/plugin-chat.repository.js";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
// 载入已安装插件条目与清单（校验 chat 宿主是否可用）
import { plugin, PluginObjectItem } from "../plugin-catalog/plugin-catalog.service.js";
// 按路径分支执行：隔离 /宿主命令 /runtime+LLM 等（内部 switch）
import { dispatchAiOrchestration } from "./ai-chat-dispatch.js";

// 从本轮 messages 载荷里取出最后一条 user 正文
import { extractLastUserMessage } from "./ai-chat-context-window.js";
import { runInSessionQueue } from "./ai-chat-session-queue.service.js";
import { resolveSessionPersistDecision } from "./session-persistence-policy.service.js";
// 本模块对外输入/上下文/输出类型
import type { PluginExecuteCompletedInput, PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import type { AiOrchestrationContext, OrchestrateChatInput, OrchestrateChatOutput } from "./ai-chat.types.js";
import { AiChatCommandEnvelope } from "./ai-chat-command-envelope.js";

/** 路由层可用的 HTTP 契约形态（与其它类型一同外放） */
export type { OrchestrateChatOutput };

export type AiChatOrchestrateRoundInput = {
  sessionId: string;
  messages: OrchestrateChatInput["messages"];
  model?: string;
  traceId?: string | null;
  stream?: OrchestrateChatInput["stream"];
  reflowMetadata?: Record<string, unknown>;
};

/**
 * 单次宿主 Chat 编排：挂载 `pluginRuntime` 与已解析的宿主 `hostPlugin`，避免编排链内反复 `pluginRuntime.plugin(hostId)`。
 * 跨插件执行仍通过 `this.pluginRuntime.plugin(targetId)`（见 `executeCommandPlugin`）。
 */
export class AiChatOrchestrator {
  constructor(
    readonly pluginRuntime: PluginRuntimePort,
    readonly hostPlugin: PluginObjectItem
  ) {}

  get pluginId(): string {
    return this.hostPlugin.pluginId;
  }

  async executeRound(input: AiChatOrchestrateRoundInput): Promise<OrchestrateChatOutput> {
    const manifest = this.hostPlugin.manifest;
    if (!manifest) {
      throw new Error("plugin not found");
    }

    const { sessionId, messages, model, traceId, stream, reflowMetadata } = input;
    const userMessage = extractLastUserMessage(messages);
    const shouldPersist = await resolveSessionPersistDecision(this.pluginRuntime, this.pluginId);

    if (shouldPersist(sessionId)) {
      appendChatMessage(this.pluginId, sessionId, "user", userMessage);
    }

    appendChatEvent({
      traceId,
      pluginId: this.pluginId,
      sessionId,
      type: "chat.request.received",
      source: "host",
      payload: { message: userMessage }
    });

    let state = getChatSessionState(this.pluginId, sessionId);
    const path = await AiChatCommandEnvelope.handler(state, userMessage, this.hostPlugin);
    console.debug("path",path);
    const ctx: AiOrchestrationContext = {
      pluginRuntime: this.pluginRuntime,
      hostPlugin: this.hostPlugin,
      state,
      hostManifest: manifest,
      pluginId: this.pluginId,
      sessionId,
      userMessage,
      messages,
      model,
      traceId,
      stream
    };

    const { state: nextState, branch } = await dispatchAiOrchestration(path, ctx);
    state = nextState;

    const {
      reply,
      sourceType,
      sourcePluginId,
      llmEligible,
      contextSummary,
      skipSseFinalReplyChunks
    } = branch;

    if (shouldPersist(sessionId)) {
      appendChatMessage(this.pluginId, sessionId, "assistant", reply, {
        sourceType,
        sourcePluginId,
        llmEligible,
        contextSummary
      });
    }

    await this.invokeExecuteCompletedReflow({
      sessionId,
      reply,
      traceId,
      reflowMetadata
    });

    appendChatEvent({
      traceId,
      pluginId: this.pluginId,
      sessionId,
      type: "chat.response.completed",
      source: "host",
      payload: { mode: state.mode }
    });

    return {
      pluginId: this.pluginId,
      sessionId,
      reply,
      sourceType,
      sourcePluginId,
      llmEligible,
      contextSummary,
      mode: state.mode,
      isolatedPluginId: state.isolatedPluginId,
      skipSseFinalReplyChunks
    };
  }

  private async invokeExecuteCompletedReflow(options: {
    sessionId: string;
    reply: string;
    traceId?: string | null;
    reflowMetadata?: Record<string, unknown>;
  }): Promise<void> {
    const { sessionId, reply, traceId, reflowMetadata } = options;
    const ext = this.hostPlugin.object as PluginRuntimeExtension | undefined;
    const payload: PluginExecuteCompletedInput = {
      sessionId,
      reply,
      metadata: reflowMetadata,
      traceId: traceId ?? undefined
    };
    if (typeof ext?.executeCompleted === "function") {
      try {
        await Promise.resolve(ext.executeCompleted(payload));
      } catch {
        // 插件侧失败不回滚已落库
      }
    }
  }
}

/**
 * 宿主 AI Chat 编排入口：会话态路由 → 插件/LLM → 统一落库 assistant。
 * 路由层可先 `await pluginRuntime.plugin(pluginId)` 传入 `plugin`，省略编排内二次查询。
 */
export async function orchestrateChat(input: OrchestrateChatInput): Promise<OrchestrateChatOutput> {
  const hostPlugin =
    input.plugin ??
    (await plugin(input.pluginId));
  if (!hostPlugin || hostPlugin.status !== "valid" || !hostPlugin.manifest) {
    throw new Error("plugin not found");
  }
  const orchestrator = new AiChatOrchestrator(input.pluginRuntime, hostPlugin);
  return runInSessionQueue(orchestrator.pluginId, input.sessionId, async () => {
    return orchestrator.executeRound({
      sessionId: input.sessionId,
      messages: input.messages,
      model: input.model,
      traceId: input.traceId,
      stream: input.stream,
      reflowMetadata: input.reflowMetadata
    });
  });
}
