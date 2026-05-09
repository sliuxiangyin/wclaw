import { randomUUID } from "node:crypto";
import type { UIMessageChunk } from "ai";

export type AiRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AiRunChunk = UIMessageChunk;

type AiRunEvent = {
  seq: number;
  chunk: AiRunChunk;
};

type AiRunSubscriber = {
  onChunk: (event: AiRunEvent) => void;
  onDone: (state: AiRunState) => void;
};

export type AiRunState = {
  runId: string;
  pluginId: string;
  sessionId: string;
  traceId: string;
  status: AiRunStatus;
  createdAt: string;
  updatedAt: string;
  events: AiRunEvent[];
  subscribers: Set<AiRunSubscriber>;
  abortController: AbortController;
  error?: { code: string; message: string };
};

const RUN_EVENT_BUFFER_LIMIT = 2000;

export class AiRunProvider {
  private readonly runs = new Map<string, AiRunState>();
  private readonly activeBySession = new Map<string, string>();

  createRun(input: { pluginId: string; sessionId: string; traceId: string }): AiRunState {
    const key = sessionKey(input.pluginId, input.sessionId);
    const activeRunId = this.activeBySession.get(key);
    if (activeRunId) {
      const active = this.runs.get(activeRunId);
      if (active && !isTerminalStatus(active.status)) {
        throw new Error("AI_RUN_ACTIVE");
      }
      this.activeBySession.delete(key);
    }

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
    this.activeBySession.set(key, runId);
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
    this.finishRun(run);
  }

  markFailed(runId: string, error: { code: string; message: string }) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "failed";
    run.error = error;
    run.updatedAt = new Date().toISOString();
    this.finishRun(run);
  }

  markCancelled(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "cancelled";
    run.updatedAt = new Date().toISOString();
    this.finishRun(run);
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
      sub.onChunk({ seq, chunk });
    }
  }

  subscribe(runId: string, input: AiRunSubscriber & { lastSeq?: number }) {
    const run = this.runs.get(runId);
    if (!run) return false;
    const lastSeq = input.lastSeq ?? 0;
    for (const ev of run.events) {
      if (ev.seq <= lastSeq) continue;
      input.onChunk(ev);
    }
    if (isTerminalStatus(run.status)) {
      input.onDone(run);
      return true;
    }
    run.subscribers.add(input);
    return true;
  }

  unsubscribe(runId: string, subscriber: AiRunSubscriber) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.subscribers.delete(subscriber);
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (isTerminalStatus(run.status)) return true;
    run.abortController.abort("cancelled-by-user");
    return true;
  }

  cancelSession(pluginId: string, sessionId: string): boolean {
    const runId = this.activeBySession.get(sessionKey(pluginId, sessionId));
    return runId ? this.cancel(runId) : false;
  }

  getAbortSignal(runId: string): AbortSignal | null {
    return this.runs.get(runId)?.abortController.signal ?? null;
  }

  private finishRun(run: AiRunState) {
    this.activeBySession.delete(sessionKey(run.pluginId, run.sessionId));
    const subscribers = [...run.subscribers];
    run.subscribers.clear();
    for (const sub of subscribers) {
      sub.onDone(run);
    }
  }
}

function sessionKey(pluginId: string, sessionId: string): string {
  return `${pluginId}\0${sessionId}`;
}

function isTerminalStatus(status: AiRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
