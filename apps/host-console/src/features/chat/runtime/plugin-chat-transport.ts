import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import type { HttpChatTransportInitOptions, UIMessage } from "ai";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type TransportOptions = {
  pluginId: string;
  sessionId: string;
  onSessionsMaybeChanged?: () => void;
};

type ReconnectRequestOptions = Parameters<
  NonNullable<HttpChatTransportInitOptions<UIMessage>["prepareReconnectToStreamRequest"]>
>[0];

type SendRequestOptions = Parameters<
  NonNullable<HttpChatTransportInitOptions<UIMessage>["prepareSendMessagesRequest"]>
>[0];

function latestUserMessage(messages: UIMessage[]): UIMessage[] {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return message ? [message] : [];
}

export class PluginChatTransport extends AssistantChatTransport<UIMessage> {
  constructor(options: TransportOptions) {
    super({
      api: `${API_BASE_URL}/api/ai/chat`,
      headers: {
        "X-Wclaw-Plugin-Id": options.pluginId,
        "X-Wclaw-Session-Id": options.sessionId
      },
      prepareReconnectToStreamRequest: async ({ headers, credentials }: ReconnectRequestOptions) => {
        return {
          api: `${API_BASE_URL}/api/ai/chat/resume-stream`,
          headers,
          credentials
        };
      },
      prepareSendMessagesRequest: async ({
        body,
        headers,
        credentials,
        id,
        messageId,
        messages,
        requestMetadata,
        trigger
      }: SendRequestOptions) => {
        return {
          body: {
            ...body,
            id,
            messages: latestUserMessage(messages as UIMessage[]),
            trigger,
            messageId,
            metadata: requestMetadata
          },
          headers,
          credentials
        };
      }
    });
    void options.onSessionsMaybeChanged;
  }
}
