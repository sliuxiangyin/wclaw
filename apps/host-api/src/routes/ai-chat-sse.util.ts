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
  chunk: Record<string, unknown> & { type: string }
) {
  writeSse(res, "chunk", chunk);
}
