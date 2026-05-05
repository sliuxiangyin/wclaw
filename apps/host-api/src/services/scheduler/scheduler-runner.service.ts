import type { PluginRuntimeExtension } from "@wclaw/plugin-sdk";
import type { PluginRuntimePort } from "../../core/plugin-runtime.port.js";
import { getPluginConfig } from "../../repositories/plugin-config.repository.js";
import { plugin, type PluginManifest } from "../plugin-catalog/plugin-catalog.service.js";
import { grantLease, revokeLease } from "../orchestration/orchestration-lease.service.js";
import { canRun, getCircuitState, onTaskFailure, onTaskSuccess } from "./scheduler-circuit-breaker.service.js";
import { emitSchedulerEvent } from "./scheduler-observer.service.js";
import { allTasks, listDueTasks, scheduleNext, type TaskDefinition } from "./scheduler-registry.service.js";

const OWNER_ID = "host-api-local";
const GLOBAL_CONCURRENCY = 20;
const PER_PLUGIN_CONCURRENCY = 5;
const TICK_MS = 500;

let timer: NodeJS.Timeout | null = null;
let runningGlobal = 0;
const runningByPlugin = new Map<string, number>();
const inFlightKeys = new Set<string>();

let pluginRuntimeRef: PluginRuntimePort | null = null;

function taskKey(task: TaskDefinition): string {
  return `${task.pluginId}\0${task.taskId}`;
}

function getPluginRunning(pluginId: string) {
  return runningByPlugin.get(pluginId) ?? 0;
}

function addPluginRunning(pluginId: string, delta: number) {
  runningByPlugin.set(pluginId, Math.max(0, getPluginRunning(pluginId) + delta));
}

function backoffMs(task: TaskDefinition, attempt: number): number {
  const base = task.backoff.baseMs;
  const max = task.backoff.maxMs;
  if (task.backoff.type === "fixed") return Math.min(max, base);
  if (task.backoff.type === "linear") return Math.min(max, base * attempt);
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function executeTask(task: TaskDefinition, _manifest: PluginManifest, traceId: string) {
  const row = pluginRuntimeRef ? await pluginRuntimeRef.plugin(task.pluginId) : null;
  const runtime = row?.object as PluginRuntimeExtension | undefined;
  if (!runtime?.runScheduledTask) {
    return;
  }
  const config = getPluginConfig(task.pluginId);
  await withTimeout(
    Promise.resolve(
      runtime.runScheduledTask(task.taskId, {
        config
      })
    ),
    task.timeoutMs
  );
  emitSchedulerEvent({
    traceId,
    pluginId: task.pluginId,
    taskId: task.taskId,
    type: "success"
  });
}

async function runDueTask(task: TaskDefinition) {
  const key = taskKey(task);
  if (inFlightKeys.has(key)) return;
  if (runningGlobal >= GLOBAL_CONCURRENCY) return;
  if (getPluginRunning(task.pluginId) >= PER_PLUGIN_CONCURRENCY) return;
  if (!canRun(task.pluginId)) {
    emitSchedulerEvent({
      traceId: `${Date.now()}-${task.pluginId}-${task.taskId}`,
      pluginId: task.pluginId,
      taskId: task.taskId,
      type: "skip-circuit"
    });
    scheduleNext(task, Date.now() + task.intervalMs);
    return;
  }

  const catalogItem = await plugin(task.pluginId);
  if (!catalogItem?.manifest || catalogItem.status !== "valid") {
    scheduleNext(task, Date.now() + task.intervalMs);
    return;
  }

  const lease = grantLease({
    pluginId: task.pluginId,
    taskId: task.taskId,
    ownerId: OWNER_ID,
    ttlMs: task.timeoutMs + 2_000
  });

  if (!lease.granted) {
    scheduleNext(task, Date.now() + task.intervalMs);
    return;
  }

  const traceId = `${Date.now()}-${task.pluginId}-${task.taskId}`;
  inFlightKeys.add(key);
  runningGlobal += 1;
  addPluginRunning(task.pluginId, 1);
  emitSchedulerEvent({
    traceId,
    pluginId: task.pluginId,
    taskId: task.taskId,
    type: "start"
  });

  try {
    let ok = false;
    let attempt = 0;
    while (!ok && attempt <= task.maxRetry) {
      try {
        attempt += 1;
        await executeTask(task, catalogItem.manifest, traceId);
        onTaskSuccess(task.pluginId);
        ok = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onTaskFailure(task.pluginId);
        emitSchedulerEvent({
          traceId,
          pluginId: task.pluginId,
          taskId: task.taskId,
          type: message === "timeout" ? "timeout" : "fail",
          detail: message
        });
        if (attempt <= task.maxRetry) {
          const wait = backoffMs(task, attempt);
          emitSchedulerEvent({
            traceId,
            pluginId: task.pluginId,
            taskId: task.taskId,
            type: "retry",
            detail: `retry in ${wait}ms`
          });
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }

    if (getCircuitState(task.pluginId) === "open") {
      emitSchedulerEvent({
        traceId,
        pluginId: task.pluginId,
        taskId: task.taskId,
        type: "open-circuit"
      });
    }
  } finally {
    revokeLease(lease.leaseId, OWNER_ID);
    inFlightKeys.delete(key);
    runningGlobal = Math.max(0, runningGlobal - 1);
    addPluginRunning(task.pluginId, -1);
    scheduleNext(task, Date.now() + task.intervalMs);
  }
}

async function tick() {
  const due = listDueTasks(Date.now());
  await Promise.all(due.map((task) => runDueTask(task)));
}

export function startSchedulerRunner(pluginRuntime: PluginRuntimePort) {
  if (timer) return;
  pluginRuntimeRef = pluginRuntime;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
}

export function stopSchedulerRunner() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  pluginRuntimeRef = null;
}

export function getSchedulerSnapshot() {
  return {
    runningGlobal,
    taskCount: allTasks().length
  };
}

