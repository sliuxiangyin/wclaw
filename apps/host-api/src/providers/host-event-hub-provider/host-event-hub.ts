import type { PluginHostPublishInput } from "@wclaw/plugin-sdk";
import type { NotificationEvent, NotificationStreamInput } from "../../core/notification.types.js";
import type { NotificationProvider } from "../notification-provider/index.js";
import { HOST_EVENT_TOPICS, type HostEventTopic } from "./host-event-hub.topics.js";
import { createNotificationHubBridge } from "./notification-hub.provider.js";

export type HostHubPublishInput = {
  /** 可同时下发多个 topic；各 Provider 注册的 Sink 自行处理 */
  topics: readonly HostEventTopic[];
  /** 当 topics 含 `Notification`、`Toast` 或 `Chat` 时必须提供（与常驻 SSE 协议一致） */
  notification?: Omit<NotificationEvent, "id" | "ts"> & { id?: string; ts?: string };
};

type TopicSink = (input: HostHubPublishInput) => void;

/** 注入到 Hub 的 Provider 仅通过此对象挂载 Sink，不暴露全局 `registerSink`。 */
export type HostHubRegistrar = {
  registerSink(topic: string, sink: TopicSink): () => void;
};

/**
 * 可插拔单元：由 Hub 在启动时 `registerProvider` 注入。
 * Notification / 日后 Chat、Metrics 等均实现本接口，接线放在 `providers/host-event-hub-provider/`。
 */
export type HostHubProvider = {
  readonly id: string;
  attach(registrar: HostHubRegistrar): void;
};

/**
 * Host Event Hub：接收 `publish` 入站；通过 `registerProvider` 注入各域 Provider。
 * 构造时传入 **`NotificationProvider`** 即自动挂载 Notification Bridge；其它域仍用 **`registerProvider`**。
 */
export class HostEventHub {
  private readonly sinksByTopic = new Map<string, Set<TopicSink>>();
  private readonly registeredProviderIds = new Set<string>();

  private readonly registrar: HostHubRegistrar = {
    registerSink: (topic: string, sink: TopicSink) => this.registerSinkInternal(topic, sink)
  };

  constructor(notificationProvider: NotificationProvider) {
    this.registerProvider(createNotificationHubBridge(notificationProvider));
  }

  private registerSinkInternal(topic: string, sink: TopicSink): () => void {
    let set = this.sinksByTopic.get(topic);
    if (!set) {
      set = new Set();
      this.sinksByTopic.set(topic, set);
    }
    set.add(sink);
    return () => {
      set!.delete(sink);
      if (set!.size === 0) this.sinksByTopic.delete(topic);
    };
  }

  private publishImpl(input: HostHubPublishInput): void {
    const seen = new Set<string>();
    for (const topic of input.topics) {
      if (seen.has(topic)) continue;
      seen.add(topic);
      const sinks = this.sinksByTopic.get(topic);
      if (!sinks || sinks.size === 0) continue;
      for (const sink of sinks) {
        try {
          sink(input);
        } catch {
          // 单 Sink 异常不影响其它 Sink
        }
      }
    }
  }

  /**
   * 注入 Provider（幂等：同一 `id` 仅挂载一次）。
   */
  registerProvider(provider: HostHubProvider): void {
    if (this.registeredProviderIds.has(provider.id)) return;
    this.registeredProviderIds.add(provider.id);
    provider.attach(this.registrar);
  }

  publish(input: HostHubPublishInput): void {
    this.publishImpl(input);
  }

  getPublish(): (input: PluginHostPublishInput) => void {
    return (input: PluginHostPublishInput) => {
      this.publish(input as unknown as HostHubPublishInput);
    };
  }

  /**
   * 固定走 Notification topic → Hub → NotificationProvider → 常驻 SSE。
   * 由组合根在 `bootstrapScheduler` 前注入 `registerSchedulerNotificationPublisher`。
   */
  createPublishNotificationStream(): (input: NotificationStreamInput) => void {
    return (input: NotificationStreamInput) => {
      this.publish({
        topics: [HOST_EVENT_TOPICS.Notification],
        notification: input
      });
    };
  }

  /**
   * 固定走 Toast topic → 同一条 Notification SSE；`notification.type` 建议使用 `ui.toast`。
   */
  createPublishToastStream(): (input: NotificationStreamInput) => void {
    return (input: NotificationStreamInput) => {
      this.publish({
        topics: [HOST_EVENT_TOPICS.Toast],
        notification: input
      });
    };
  }
}
