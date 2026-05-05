export type NotificationLevel = "debug" | "info" | "warn" | "error";

export type NotificationEventType =
  | "system.notice"
  | "ui.toast"
  | "chat.session.updated"
  | "scheduler.task_started"
  | "scheduler.task_succeeded"
  | "scheduler.task_failed";

export type NotificationScope = {
  pluginId?: string;
  sessionId?: string;
};

export type NotificationEvent = {
  id: string;
  type: NotificationEventType;
  ts: string;
  level: NotificationLevel;
  scope?: NotificationScope;
  payload?: Record<string, unknown>;
};

export type NotificationStreamInput = Omit<NotificationEvent, "id" | "ts"> & { id?: string; ts?: string };
