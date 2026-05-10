import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CHAT_SESSION_UPDATED_EVENT,
  type ChatSessionUpdatedDetail
} from "@/features/chat/lib/chat-host-events";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

/** 与后端 `NotificationEventType` 对齐；SSE 使用 `event: <type>`，须 `addEventListener` 才能收到。 */
const NOTIFICATION_SSE_EVENT_TYPES = [
  "ui.toast",
  "system.notice",
  "chat.session.updated",
  "scheduler.task_started",
  "scheduler.task_succeeded",
  "scheduler.task_failed"
] as const;

export type NotificationStreamEvent = {
  id: string;
  type: string;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope?: {
    pluginId?: string;
    sessionId?: string;
  };
  payload?: Record<string, unknown>;
};

export function useNotificationStream() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<NotificationStreamEvent | null>(null);

  const streamUrl = useMemo(() => `${API_BASE_URL}/api/notifications/stream?scope=global`, []);

  useEffect(() => {
    const es = new EventSource(streamUrl);
    es.onopen = () => {
      setConnected(true);
      console.info("[notification-sse] connected");
    };
    es.onerror = () => {
      setConnected(false);
      console.warn("[notification-sse] disconnected, waiting retry");
    };

    const onNamedEvent = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data) as NotificationStreamEvent;
        setLastEvent(data);
        // console.info("[notification-sse:event]", data.type, data);
        if (data.type === "ui.toast") {
          const p = data.payload;
          const title = typeof p?.title === "string" ? p.title : "提示";
          const body = typeof p?.body === "string" ? p.body : undefined;
          toast(title, { description: body, duration: 4500 });
        }
        if (data.type === "chat.session.updated") {
          const pluginId = data.scope?.pluginId;
          const sessionId = data.scope?.sessionId;
          if (typeof pluginId === "string" && typeof sessionId === "string") {
            const reason =
              typeof data.payload?.reason === "string" ? data.payload.reason : undefined;
            window.dispatchEvent(
              new CustomEvent<ChatSessionUpdatedDetail>(CHAT_SESSION_UPDATED_EVENT, {
                detail: { pluginId, sessionId, reason }
              })
            );
          }
        }
      } catch (error) {
        console.warn("[notification-sse] invalid event payload", error);
      }
    };

    for (const eventType of NOTIFICATION_SSE_EVENT_TYPES) {
      es.addEventListener(eventType, onNamedEvent as EventListener);
    }

    return () => {
      for (const eventType of NOTIFICATION_SSE_EVENT_TYPES) {
        es.removeEventListener(eventType, onNamedEvent as EventListener);
      }
      es.close();
      setConnected(false);
    };
  }, [streamUrl]);

  return { connected, lastEvent };
}

