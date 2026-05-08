import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

export type AiRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AiRunChunk = Record<string, unknown> & { type: string };

type AiRunEvent = {
  seq: number;
  chunk: AiRunChunk;
};

type AiRunState = {
  runId: string;
  pluginId: string;
  sessionId: string;
  traceId: string;
  status: AiRunStatus;
  createdAt: string;
  updatedAt: string;
  events: AiRunEvent[];
  subscribers: Set<ServerResponse>;
  abortController: AbortController;
  error?: { code: string; message: string };
};

const RUN_EVENT_BUFFER_LIMIT = 2000;

export class AiRunProvider {
  private readonly runs = new Map<string, AiRunState>();

  createRun(input: { pluginId: string; sessionId: string; traceId: string }): AiRunState {
    const runId = randomUUID();
    const now = new Date().toISOString();
    const state: AiRunState = {
      runId,
      pluginId: input.pluginId,
      sessionId: input.sessionId,
      traceId: input.traceId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
      subscribers: new Set(),
      abortController: new AbortController()
    };
    this.runs.set(runId, state);
    return state;
  }

  getRun(runId: string): AiRunState | null {
    return this.runs.get(runId) ?? null;
  }

  markRunning(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "running";
    run.updatedAt = new Date().toISOString();
  }

  markCompleted(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "completed";
    run.updatedAt = new Date().toISOString();
  }

  markFailed(runId: string, error: { code: string; message: string }) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "failed";
    run.error = error;
    run.updatedAt = new Date().toISOString();
  }

  markCancelled(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "cancelled";
    run.updatedAt = new Date().toISOString();
  }

  appendChunk(runId: string, chunk: AiRunChunk) {
    const run = this.runs.get(runId);
    if (!run) return;
    const seq = run.events.length > 0 ? run.events[run.events.length - 1]!.seq + 1 : 1;
    run.events.push({ seq, chunk });
    if (run.events.length > RUN_EVENT_BUFFER_LIMIT) {
      run.events.shift();
    }
    run.updatedAt = new Date().toISOString();
    for (const sub of run.subscribers) {
      sub.write(`event: chunk\n`);
      sub.write(`data: ${JSON.stringify({ seq, chunk })}\n\n`);
    }
  }

  subscribe(runId: string, res: ServerResponse, lastSeq: number) {
    const run = this.runs.get(runId);
    if (!run) return false;
    for (const ev of run.events) {
      if (ev.seq <= lastSeq) continue;
      res.write(`event: chunk\n`);
      res.write(`data: ${JSON.stringify({ seq: ev.seq, chunk: ev.chunk })}\n\n`);
    }
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      res.end();
      return true;
    }
    run.subscribers.add(res);
    return true;
  }

  unsubscribe(runId: string, res: ServerResponse) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.subscribers.delete(res);
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return true;
    run.abortController.abort("cancelled-by-user");
    run.status = "cancelled";
    run.updatedAt = new Date().toISOString();
    return true;
  }

  getAbortSignal(runId: string): AbortSignal | null {
    return this.runs.get(runId)?.abortController.signal ?? null;
  }
}
