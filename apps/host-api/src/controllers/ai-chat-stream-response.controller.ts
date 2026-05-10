import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { createUIMessageStream, createUIMessageStreamResponse, UIMessageStreamWriter, type UIMessage } from "ai";
import type { PluginToolLikeStepPayload } from "@wclaw/plugin-sdk";
import { upsertUiMessage } from "../repositories/plugin-chat.repository.js";

export type OrchestratedTextStreamCallbacks = {
  onStart?: (meta: { sourceType: "runtime" | "plugin"; sourcePluginId: string | null }) => void;
  onTextDelta?: (delta: string) => void;
  onToolLikeStep?: (step: PluginToolLikeStepPayload) => void;
};

type StreamingTextResult = {
  text: string;
  sourceType?: "runtime" | "plugin";
  sourcePluginId?: string | null;
  llmEligible?: boolean;
  contextSummary?: string | null;
  skipFinalReplyChunks?: boolean;
};

type ToolLikePart =
  | {
      type: "dynamic-tool";
      toolName: string;
      toolCallId: string;
      state: "input-available";
      input: unknown;
      output: unknown;
    }
  | {
      type: "dynamic-tool";
      toolName: string;
      toolCallId: string;
      state: "output-available";
      input: unknown;
      output: unknown;
    }
  | {
      type: "dynamic-tool";
      toolName: string;
      toolCallId: string;
      state: "output-error";
      input: unknown;
      output: unknown;
      errorText: string;
    };

type PersistedToolFinalPart = {
  type: "dynamic-tool";
  state: "output-available";
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
};

function toToolLikePart(step: PluginToolLikeStepPayload): ToolLikePart {
  const rawName = step.toolName;
  const toolCallId = step.stepId ?? `plugin-step:${randomUUID()}`;
  const input = step.input ?? {};
  const output = step.output ?? {};
  if (step.state === "output-error") {
    return {
      type: "dynamic-tool",
      toolName: rawName,
      toolCallId,
      state: "output-error",
      input,
      output,
      errorText: step.errorText ?? "plugin step error"
    };
  }
  if (step.state === "output-available") {
    return {
      type: "dynamic-tool",
      toolName: rawName,
      toolCallId,
      state: "output-available",
      input,
      output
    };
  }
  return {
    type: "dynamic-tool",
    toolName: rawName,
    toolCallId,
    state: "input-available",
    input,
    output
  };
}

export function textFromUiMessage(message: UIMessage): string {
  return (message.parts ?? [])
    .map((part) => {
      const rec = part as Record<string, unknown>;
      return rec.type === "text" && typeof rec.text === "string" ? rec.text : "";
    })
    .filter(Boolean)
    .join("")
    .trim();
}

export function hasPersistableParts(message: UIMessage): boolean {
  return (message.parts ?? []).some((part) => {
    const rec = part as Record<string, unknown>;
    if (rec.type === "text") {
      return typeof rec.text === "string" && rec.text.trim().length > 0;
    }
    return typeof rec.type === "string" && rec.type.length > 0;
  });
}

export function withCancelledMetadata(message: UIMessage, isAborted: boolean): UIMessage {
  if (!isAborted) return message;
  const metadata =
    message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : {};
  return {
    ...message,
    metadata: {
      ...metadata,
      cancelled: true
    }
  };
}

export function createTextStreamResponse(input: {
  text: string;
  pluginId: string;
  sessionId: string;
  traceId: string;
  sourceType?: "runtime" | "plugin";
  sourcePluginId?: string | null;
  llmEligible?: boolean;
  contextSummary?: string | null;
}) {
  const assistantMessage: UIMessage = {
    id: `assistant:${randomUUID()}`,
    role: "assistant",
    metadata: {
      source:
        input.sourceType === "plugin" && input.sourcePluginId ? `plugin:${input.sourcePluginId}` : "runtime"
    },
    parts: [{ type: "text", text: input.text }]
  };
  upsertUiMessage({
    pluginId: input.pluginId,
    sessionId: input.sessionId,
    message: assistantMessage,
    traceId: input.traceId,
    sourceType: input.sourceType,
    sourcePluginId: input.sourcePluginId,
    llmEligible: input.llmEligible,
    contextSummary: input.contextSummary
  });
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute({ writer }) {
        const textId = "text-1";
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: input.text });
        writer.write({ type: "text-end", id: textId });
      }
    })
  });
}

export function createOrchestratedTextStreamResponse(input: {
  pluginId: string;
  sessionId: string;
  traceId: string;
  run: (stream: OrchestratedTextStreamCallbacks) => Promise<StreamingTextResult>;
}) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      async execute({ writer }) {
        const textId = "text-1";
        let textStarted = false;
        let visibleText = "";
        let pendingPersistText = "";
        const persistedTimeline: Array<
          | { type: "text"; text: string }
          | { type: "tool-ref"; toolCallId: string }
        > = [];
        const timelineToolInserted = new Set<string>();
        const toolLikePartsByCallId = new Map<
          string,
          {
            toolCallId: string;
            toolName: string;
            input: unknown;
            output: unknown;
            firstSeenIndex: number;
          }
        >();
        let toolSeenCounter = 0;
        const startedToolCalls = new Set<string>();
        const ensureTextStart = () => {
          if (textStarted) return;
          writer.write({ type: "text-start", id: textId });
          textStarted = true;
        };
        const flushPendingPersistText = () => {
          if (pendingPersistText.length === 0) return;
          persistedTimeline.push({ type: "text", text: pendingPersistText });
          pendingPersistText = "";
        };
        const result = await input.run({
          onStart: () => {
            ensureTextStart();
          },
          onTextDelta: (delta) => {
            if (delta.length === 0) return;
            ensureTextStart();
            visibleText += delta;
            pendingPersistText += delta;
            writer.write({ type: "text-delta", id: textId, delta });
          },
          onToolLikeStep: (step) => {
            const part = toToolLikePart(step);
            flushPendingPersistText();
            if (!timelineToolInserted.has(part.toolCallId)) {
              persistedTimeline.push({ type: "tool-ref", toolCallId: part.toolCallId });
              timelineToolInserted.add(part.toolCallId);
            }
            let aggregate = toolLikePartsByCallId.get(part.toolCallId);
            if (!aggregate) {
              aggregate = {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input ?? {},
                output: {},
                firstSeenIndex: toolSeenCounter++
              };
              toolLikePartsByCallId.set(part.toolCallId, aggregate);
            }
            aggregate.toolName = part.toolName;
            if (part.input !== undefined) {
              aggregate.input = part.input;
            }
            if (part.state === "output-available") {
              aggregate.output = part.output;
            } else if (part.state === "output-error") {
              aggregate.output = {
                isError: true,
                errorText: part.errorText,
                content: [{ type: "text", text: part.errorText }]
              };
            }
            if (!startedToolCalls.has(part.toolCallId)) {
              writer.write({
                type: "tool-input-start",
                toolCallId: part.toolCallId,
                toolName: part.toolName
              });
              writer.write({
                type: "tool-input-available",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              });
              startedToolCalls.add(part.toolCallId);
            }
            if (part.state === "output-available") {
              writer.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output: part.output
              });
            } else if (part.state === "output-error") {
              writer.write({
                type: "tool-output-error",
                toolCallId: part.toolCallId,
                errorText: part.errorText,
              });
            }
          }
        });
        ensureTextStart();
        if (!result.skipFinalReplyChunks && result.text.length > 0) {
          visibleText += result.text;
          pendingPersistText += result.text;
          writer.write({ type: "text-delta", id: textId, delta: result.text });
        }
        writer.write({ type: "text-end", id: textId });
        flushPendingPersistText();
        const persistedToolPartsByCallId = new Map<string, PersistedToolFinalPart>(
          [...toolLikePartsByCallId.values()]
            .sort((a, b) => a.firstSeenIndex - b.firstSeenIndex)
            .map((agg) => [
              agg.toolCallId,
              {
                type: "dynamic-tool",
                state: "output-available",
                toolCallId: agg.toolCallId,
                toolName: agg.toolName,
                input: agg.input,
                output: agg.output
              } satisfies PersistedToolFinalPart
            ])
        );
        const persistedParts: UIMessage["parts"] = [];
        for (const item of persistedTimeline) {
          if (item.type === "text") {
            persistedParts.push({ type: "text", text: item.text } as UIMessage["parts"][number]);
            continue;
          }
          const tool = persistedToolPartsByCallId.get(item.toolCallId);
          if (tool) {
            persistedParts.push(tool as UIMessage["parts"][number]);
          }
        }
        const assistantMessage: UIMessage = {
          id: `assistant:${randomUUID()}`,
          role: "assistant",
          metadata: {
            source:
              result.sourceType === "plugin" && result.sourcePluginId ? `plugin:${result.sourcePluginId}` : "runtime"
          },
          parts: persistedParts
        };
        upsertUiMessage({
          pluginId: input.pluginId,
          sessionId: input.sessionId,
          message: assistantMessage,
          traceId: input.traceId,
          sourceType: result.sourceType,
          sourcePluginId: result.sourcePluginId,
          llmEligible: result.llmEligible,
          contextSummary: result.contextSummary
        });
      }
    })
  });
}

export async function sendWebResponse(reply: FastifyReply, response: Response) {
  reply.hijack();
  const res = reply.raw;
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const requestOrigin = reply.request.headers.origin;
  if (typeof requestOrigin === "string" && requestOrigin.length > 0) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = headers.Vary ? `${headers.Vary}, Origin` : "Origin";
  }
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream).pipe(res);
}
