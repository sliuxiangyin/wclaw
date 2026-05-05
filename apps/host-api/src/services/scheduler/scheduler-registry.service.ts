import type { PluginScheduledTask } from "@wclaw/plugin-sdk";

export type BackoffPolicy = {
  type: "fixed" | "linear" | "exponential";
  baseMs: number;
  maxMs: number;
};

export type TaskDefinition = {
  pluginId: string;
  taskId: string;
  intervalMs: number;
  jitterMs: number;
  timeoutMs: number;
  maxRetry: number;
  backoff: BackoffPolicy;
  enabled: boolean;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRY = 3;
const DEFAULT_BACKOFF: BackoffPolicy = {
  type: "exponential",
  baseMs: 500,
  maxMs: 10_000
};

const tasks = new Map<string, TaskDefinition>();
const nextRunAtByKey = new Map<string, number>();

function keyOf(pluginId: string, taskId: string): string {
  return `${pluginId}\0${taskId}`;
}

function jitterValue(ms: number): number {
  if (ms <= 0) return 0;
  return Math.floor(Math.random() * (ms + 1));
}

function normalizeTask(pluginId: string, task: PluginScheduledTask): TaskDefinition | null {
  if (!task?.taskId || typeof task.taskId !== "string") return null;
  const intervalMs = Number(task.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  return {
    pluginId,
    taskId: task.taskId,
    intervalMs,
    jitterMs: Math.max(0, Number(task.jitterMs ?? 0)),
    timeoutMs: Math.max(1_000, Number(task.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    maxRetry: Math.max(0, Number(task.maxRetry ?? DEFAULT_MAX_RETRY)),
    backoff: task.backoff
      ? {
          type: task.backoff.type,
          baseMs: Math.max(100, Number(task.backoff.baseMs)),
          maxMs: Math.max(500, Number(task.backoff.maxMs))
        }
      : DEFAULT_BACKOFF,
    enabled: task.enabled !== false
  };
}

export function registerPluginTasks(pluginId: string, declaredTasks: PluginScheduledTask[]) {
  const now = Date.now();
  const prefix = `${pluginId}\0`;
  for (const key of tasks.keys()) {
    if (key.startsWith(prefix)) {
      tasks.delete(key);
      nextRunAtByKey.delete(key);
    }
  }

  let count = 0;
  for (const raw of declaredTasks) {
    const task = normalizeTask(pluginId, raw);
    if (!task) continue;
    const key = keyOf(pluginId, task.taskId);
    tasks.set(key, task);
    nextRunAtByKey.set(key, now + task.intervalMs + jitterValue(task.jitterMs));
    count += 1;
  }
  return { registered: count };
}

export function unregisterPluginTasks(pluginId: string) {
  const prefix = `${pluginId}\0`;
  for (const key of tasks.keys()) {
    if (key.startsWith(prefix)) {
      tasks.delete(key);
      nextRunAtByKey.delete(key);
    }
  }
}

export function listDueTasks(now = Date.now()): TaskDefinition[] {
  const due: TaskDefinition[] = [];
  for (const [key, task] of tasks) {
    if (!task.enabled) continue;
    if ((nextRunAtByKey.get(key) ?? 0) <= now) {
      due.push(task);
    }
  }
  return due;
}

export function scheduleNext(task: TaskDefinition, nextAt: number) {
  nextRunAtByKey.set(keyOf(task.pluginId, task.taskId), nextAt);
}

export function allTasks() {
  return Array.from(tasks.values());
}

