import { randomUUID } from "node:crypto";
import { createUIMessageStreamResponse, type UIMessage, type UIMessageChunk } from "ai";
import type { NotificationStreamInput } from "../core/notification.types.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { appendChatEvent } from "../repositories/chat-event.repository.js";
import { upsertUiMessage } from "../repositories/plugin-chat.repository.js";
import type { AiRunProvider } from "../providers/ai-run-provider/index.js";
import { buildRuntimeDefaultLlmTools } from "../services/ai-chat/ai-chat-runtime-default.js";
import { streamUiMessagesWithConfiguredLlm } from "../services/llm/llm-runtime.service.js";
import {
  hasPersistableParts,
  textFromUiMessage
} from "./ai-chat-stream-response.controller.js";

type PublishNotificationStream = (input: NotificationStreamInput) => void;

function createAssistantEndMessage(input: {
  message?: UIMessage;
  cancelled?: boolean;
  failed?: boolean;
  errorMessage?: string;
}): UIMessage {
  const message =
    input.message ??
    ({
      id: `assistant:${randomUUID()}`,
      role: "assistant",
      parts: []
    } satisfies UIMessage);
  const metadata =
    message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : {};
  return {
    ...message,
    role: "assistant",
    metadata: {
      ...metadata,
      ...(input.cancelled ? { cancelled: true } : {}),
      ...(input.failed ? { failed: true, errorMessage: input.errorMessage ?? "LLM 调用失败" } : {}),
      ...(!hasPersistableParts(message) ? { empty: true } : {})
    },
    parts: Array.isArray(message.parts) ? message.parts : []
  };
}

function notifyChatSessionUpdated(
  publishNotification: PublishNotificationStream | undefined,
  input: { pluginId: string; sessionId: string; traceId: string; reason: string }
) {
  try {
    publishNotification?.({
      type: "chat.session.updated",
      level: "info",
      scope: { pluginId: input.pluginId, sessionId: input.sessionId },
      payload: { reason: input.reason, traceId: input.traceId }
    });
  } catch {
    // 通知失败不影响消息落库。
  }
}

export function createAiRunStreamResponse(aiRunProvider: AiRunProvider, runId: string) {
  let subscriber: Parameters<AiRunProvider["subscribe"]>[1] | null = null;
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      subscriber = {
        onChunk: ({ chunk }: { seq: number; chunk: UIMessageChunk }) => {
          try {
            controller.enqueue(chunk);
          } catch {
            // 浏览器断开后忽略写入错误，后台 run 继续执行。
          }
        },
        onDone: () => {
          try {
            controller.close();
          } catch {
            // no-op
          }
        }
      };
      const ok = aiRunProvider.subscribe(runId, subscriber);
      if (!ok) {
        controller.enqueue({ type: "error", errorText: "AI run not found" });
        controller.close();
      }
      return () => {
        if (subscriber) {
          aiRunProvider.unsubscribe(runId, subscriber);
        }
      };
    },
    cancel() {
      // 只取消本次 HTTP 订阅，不取消后台 LLM run。
      if (subscriber) {
        aiRunProvider.unsubscribe(runId, subscriber);
      }
    }
  });
  return createUIMessageStreamResponse({ stream });
}

export async function consumeLlmRun(input: {
  aiRunProvider: AiRunProvider;
  runId: string;
  pluginId: string;
  sessionId: string;
  traceId: string;
  messages: UIMessage[];
  system: string;
  model?: string;
  tools: ReturnType<typeof buildRuntimeDefaultLlmTools>["tools"];
  mode: string;
  publishNotification?: PublishNotificationStream;
}) {
  const { aiRunProvider, runId, pluginId, sessionId, traceId, messages, system, model, tools, mode, publishNotification } = input;
  let persisted = false;
  const abortSignal = aiRunProvider.getAbortSignal(runId) ?? undefined;
  try {
    aiRunProvider.markRunning(runId);
    const result = await streamUiMessagesWithConfiguredLlm({
      messages,
      system,
      modelOverride: model,
      tools,
      abortSignal
    });
    const stream = result.toUIMessageStream({
      originalMessages: messages,
      onFinish: ({ responseMessage, isAborted }) => {
        const cancelled = isAborted || abortSignal?.aborted === true;
        const persistedMessage = createAssistantEndMessage({ message: responseMessage, cancelled });
        upsertUiMessage({
          pluginId,
          sessionId,
          message: persistedMessage,
          traceId,
          sourceType: "runtime",
          llmEligible: true
        });
        appendChatEvent({
          traceId,
          pluginId,
          sessionId,
          type: cancelled ? "chat.response.cancelled" : "chat.response.completed",
          source: "host",
          payload: { mode, textLength: textFromUiMessage(responseMessage).length, cancelled }
        });
        notifyChatSessionUpdated(publishNotification, {
          pluginId,
          sessionId,
          traceId,
          reason: cancelled ? "web.llm.cancelled" : "web.llm.completed"
        });
        persisted = true;
      }
    });
    for await (const chunk of stream) {
      aiRunProvider.appendChunk(runId, chunk);
    }
    if (abortSignal?.aborted) {
      aiRunProvider.markCancelled(runId);
    } else {
      aiRunProvider.markCompleted(runId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM 调用失败";
    const cancelled = abortSignal?.aborted === true;
    if (!persisted) {
      const failedMessage = createAssistantEndMessage({
        cancelled,
        failed: !cancelled,
        errorMessage: message
      });
      upsertUiMessage({
        pluginId,
        sessionId,
        message: failedMessage,
        traceId,
        sourceType: "runtime",
        llmEligible: true
      });
      appendChatEvent({
        traceId,
        pluginId,
        sessionId,
        type: cancelled ? "chat.response.cancelled" : "chat.response.completed",
        source: "host",
        payload: { mode, textLength: 0, cancelled, failed: !cancelled }
      });
      notifyChatSessionUpdated(publishNotification, {
        pluginId,
        sessionId,
        traceId,
        reason: cancelled ? "web.llm.cancelled" : "web.llm.failed"
      });
    }
    aiRunProvider.appendChunk(runId, { type: "error", errorText: message });
    if (cancelled) {
      aiRunProvider.markCancelled(runId);
    } else {
      aiRunProvider.markFailed(runId, { code: ERROR_CODES.LLM_UPSTREAM_ERROR, message });
    }
  }
}
