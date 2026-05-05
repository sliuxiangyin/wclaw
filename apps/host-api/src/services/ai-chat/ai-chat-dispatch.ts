import type { ChatSessionState } from "../../repositories/chat-session.repository.js";
import { orchestrateHostCommandMatched } from "./ai-chat-host-command.js";
import { orchestrateIsolatedClose, orchestrateIsolatedDelegate } from "./ai-chat-isolated.js";
import type { AiOrchestrationPath } from "./ai-chat-command-envelope.js";
import { executeRuntimeDefault } from "./ai-chat-runtime-default.js";
import type { AiOrchestrationContext, ChatBranchResult } from "./ai-chat.types.js";

function hostEnvelopeInvalidBranch(): ChatBranchResult {
  return {
    reply: "命令格式错误。用法：/command <pluginId> [args]",
    sourceType: "runtime",
    sourcePluginId: null,
    llmEligible: false,
    contextSummary: "invalid_command_format",
    skipSseFinalReplyChunks: false
  };
}

/** 根据 `resolveAiOrchestrationPath` 的判别执行对应分支（唯一允许集中 `switch` 之处） */
export async function dispatchAiOrchestration(
  path: AiOrchestrationPath,
  ctx: AiOrchestrationContext
): Promise<{ state: ChatSessionState; branch: ChatBranchResult }> {
  switch (path.kind) {
    case "isolated_close":
      return orchestrateIsolatedClose(ctx);
    case "isolated_delegate":
      return orchestrateIsolatedDelegate(ctx);
    case "host_bad_format":
      return { state: ctx.state, branch: hostEnvelopeInvalidBranch() };
    case "host_command":
      return orchestrateHostCommandMatched(ctx, {
        targetPluginId: path.targetPluginId,
        commandText: path.commandText
      });
    case "runtime_default":
      return {
        state: ctx.state,
        branch: await executeRuntimeDefault(
          ctx.pluginRuntime,
          ctx.hostManifest,
          ctx.pluginId,
          ctx.sessionId,
          ctx.userMessage,
          ctx.messages,
          ctx.model,
          ctx.traceId,
          ctx.stream
        )
      };
  }
}
