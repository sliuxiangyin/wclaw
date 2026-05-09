import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { upsertUiMessage } from "../repositories/plugin-chat.repository.js";

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
