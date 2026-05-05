import type { NotificationStreamInput } from "../../core/notification.types.js";

type SchedulerEventType =
  | "start"
  | "success"
  | "fail"
  | "timeout"
  | "retry"
  | "open-circuit"
  | "skip-circuit";

type SchedulerEvent = {
  at: string;
  traceId: string;
  pluginId: string;
  taskId: string;
  type: SchedulerEventType;
  detail?: string;
};

const events: SchedulerEvent[] = [];
const MAX_EVENTS = 500;

type PublishNotificationStream = (input: NotificationStreamInput) => void;

let publishToNotificationStream: PublishNotificationStream | null = null;

/**
 * 由组合根在 `bootstrapScheduler` 之前调用，注入经 Hub 的发布函数（如 `hostEventHub.createPublishNotificationStream()`）。
 */
export function registerSchedulerNotificationPublisher(fn: PublishNotificationStream): void {
  publishToNotificationStream = fn;
}

export function emitSchedulerEvent(event: Omit<SchedulerEvent, "at">) {
  const row = {
    ...event,
    at: new Date().toISOString()
  };
  events.push(row);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  const toNotificationType = (type: SchedulerEventType) => {
    if (type === "start") return "scheduler.task_started" as const;
    if (type === "success") return "scheduler.task_succeeded" as const;
    return "scheduler.task_failed" as const;
  };

  publishToNotificationStream?.({
    type: toNotificationType(event.type),
    level: event.type === "success" ? "info" : event.type === "start" ? "debug" : "warn",
    scope: { pluginId: event.pluginId },
    payload: {
      traceId: event.traceId,
      pluginId: event.pluginId,
      taskId: event.taskId,
      schedulerType: event.type,
      detail: event.detail
    }
  });
}

export function listSchedulerEvents(limit = 100): SchedulerEvent[] {
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return events.slice(-n);
}
