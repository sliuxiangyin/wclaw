import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { cancelAiRun, postAiChatStream, type PluginActivityPayload } from "../../../lib/api/ai-chat.api";

type TransportOptions = {
  pluginId: string;
  sessionId: string;
  onSessionsMaybeChanged?: () => void;
  onPluginActivity?: (payload: PluginActivityPayload) => void;
  /** 每次发起新的流式请求前调用，用于清空插件活动区 */
  onActivityStreamReset?: () => void;
};

export class PluginChatTransport implements ChatTransport<UIMessage> {
  private readonly pluginId: string;
  private readonly sessionId: string;
  private readonly onSessionsMaybeChanged?: () => void;
  private readonly onPluginActivity?: (payload: PluginActivityPayload) => void;
  private readonly onActivityStreamReset?: () => void;
  private activeRunId: string | null = null;
  private activeSeq = 0;

  constructor(options: TransportOptions) {
    this.pluginId = options.pluginId;
    this.sessionId = options.sessionId;
    this.onSessionsMaybeChanged = options.onSessionsMaybeChanged;
    this.onPluginActivity = options.onPluginActivity;
    this.onActivityStreamReset = options.onActivityStreamReset;
  }

  async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
  } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
    this.onActivityStreamReset?.();
    this.activeRunId = null;
    this.activeSeq = 0;
    options.abortSignal?.addEventListener("abort", () => {
      if (!this.activeRunId) return;
      void cancelAiRun(this.activeRunId);
    }, { once: true });
    return postAiChatStream({
      pluginId: this.pluginId,
      sessionId: this.sessionId,
      messages: options.messages,
      onRunCreated: (runId) => {
        this.activeRunId = runId;
      },
      onChunkSeq: (seq) => {
        this.activeSeq = seq;
      },
      onPluginActivity: this.onPluginActivity,
      onFinish: () => {
        this.activeRunId = null;
        this.activeSeq = 0;
        this.onSessionsMaybeChanged?.();
      }
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    if (!this.activeRunId) return null;
    return postAiChatStream({
      pluginId: this.pluginId,
      sessionId: this.sessionId,
      messages: [],
      resume: {
        runId: this.activeRunId,
        lastSeq: this.activeSeq
      },
      onRunCreated: (runId) => {
        this.activeRunId = runId;
      },
      onChunkSeq: (seq) => {
        this.activeSeq = seq;
      },
      onPluginActivity: this.onPluginActivity,
      onFinish: () => {
        this.activeRunId = null;
        this.activeSeq = 0;
        this.onSessionsMaybeChanged?.();
      }
    });
  }
}
