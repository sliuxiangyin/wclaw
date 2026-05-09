import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type TransportOptions = {
  pluginId: string;
  sessionId: string;
  onSessionsMaybeChanged?: () => void;
};

export class PluginChatTransport extends AssistantChatTransport {
  constructor(options: TransportOptions) {
    super({
      api: `${API_BASE_URL}/api/ai/chat`,
      headers: {
        "X-Wclaw-Plugin-Id": options.pluginId,
        "X-Wclaw-Session-Id": options.sessionId
      }
    });
    void options.onSessionsMaybeChanged;
  }
}
