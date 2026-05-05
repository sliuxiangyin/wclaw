import { AssistantRuntimeProvider, type TextMessagePartProps, useAuiState } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@assistant-ui/react-ui";
import { useMemo } from "react";
import type { PluginListItem } from "../../../lib/api/plugins.api";
import { resolvePluginThreadGuide } from "../lib/resolve-plugin-thread-guide";
import { PluginChatTransport } from "../runtime/plugin-chat-transport";

type Props = {
  plugin: PluginListItem;
  sessionId: string;
  onSessionsMaybeChanged?: () => void;
};

export function AssistantChatShell({ plugin, sessionId, onSessionsMaybeChanged }: Props) {
  const transport = useMemo(
    () =>
      new PluginChatTransport({
        pluginId: plugin.pluginId,
        sessionId,
        onSessionsMaybeChanged
      }),
    [plugin.pluginId, sessionId, onSessionsMaybeChanged]
  );
  const runtime = useChatRuntime({ transport });
  const { welcomeMessage, suggestions } = useMemo(
    () => resolvePluginThreadGuide(plugin, sessionId),
    [plugin, sessionId]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full min-h-0 overflow-hidden">
        <Thread
          welcome={{
            message: welcomeMessage,
            suggestions
          }}
          strings={{
            composer: {
              input: { placeholder: "发送消息.... (@ 表示提及，/ 表示命令)" }
            }
          }}
          assistantMessage={{
            components: {
              Text: SourceAwareTextPart
            }
          }}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

function SourceAwareTextPart(props: TextMessagePartProps) {
  const source = useAuiState((s) => {
    const meta = s.message.metadata as { source?: string } | undefined;
    return meta?.source;
  });
  const text = props.text ?? "";

  return (
    <div>
      <p className="whitespace-pre-wrap">{text}</p>
      {source ? (
        <p className="mt-1 inline-block rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          来源: {source}
        </p>
      ) : null}
    </div>
  );
}
