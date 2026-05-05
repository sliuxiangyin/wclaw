import type { ServerResponse } from "node:http";

export function chunkText(text: string, size: number): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export function writeSse(res: ServerResponse, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeChunkSse(
  res: ServerResponse,
  chunk: {
    type: string;
    id?: string;
    delta?: string;
    phase?: string;
    data?: Record<string, unknown>;
    messageMetadata?: Record<string, unknown>;
  }
) {
  writeSse(res, "chunk", chunk);
}
