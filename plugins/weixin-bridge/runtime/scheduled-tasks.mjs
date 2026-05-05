import { listAccounts, pollStartedAccountsOnce } from "../bridge-adapter.mjs";
import { accountSessionId, toNumber } from "./session-state.mjs";

/** 与宿主 `HOST_EVENT_TOPICS` 一致（插件侧不 import 宿主模块）。 */
const HPC_NOTIFICATION_TOPIC = "hpc.notification";
const HPC_TOAST_TOPIC = "hpc.toast";

/**
 * 收到新消息后：经 `publish` 推到 Host Event Hub → Notification SSE。
 * @param {((input: import("@wclaw/plugin-sdk").PluginHostPublishInput) => void) | undefined} publish
 * @param {string} pluginId
 * @param {string} accountId
 * @param {unknown[]} messages
 */
function receiveNewMessages(publish, pluginId, accountId, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  for (const msg of messages) {
    const t = msg.text ?? "";
    if (msg.direction === "outbound") {
      console.log(`[weixin-bridge][${pluginId}][${accountId}] ${msg.at ?? "-"} 我: ${t}`);
    } else {
      console.log(`[weixin-bridge][${pluginId}][${accountId}] ${msg.at ?? "-"} ${t}`);
    }
  }
  if (typeof publish !== "function") return;
  const lines = messages.map((msg) => {
    return msg.text ?? "";
  });

  try {
    publish({
      topics: [HPC_NOTIFICATION_TOPIC],
      notification: {
        type: "system.notice",
        level: "info",
        scope: { pluginId },
        payload: {
          phase: "weixin.poll-inbox",
          accountId,
          messageCount: messages.length,
          lines
        }
      }
    });
  } catch {
    // publish 内单 Sink 异常已由宿主吞掉；此处兜底避免打断调度
  }
  try {
    const preview = lines.slice(0, 3).join("\n");
    publish({
      topics: [HPC_TOAST_TOPIC],
      notification: {
        type: "ui.toast",
        level: "info",
        scope: { pluginId },
        payload: {
          scene: "weixin.poll-inbox",
          accountId,
          title: "微信新消息",
          body: preview,
          messageCount: messages.length
        }
      }
    });
  } catch {
    // 同上
  }
}

/**
 * @param {import("@wclaw/plugin-sdk").ExternalUserTurnInput} payload
 * @param {import("@wclaw/plugin-sdk").PluginRuntimeExtensionDeps["ingestExternalUserTurn"] | undefined} ingestExternalUserTurn
 */
async function invokeExternalIngest(payload, ingestExternalUserTurn) {
  if (typeof ingestExternalUserTurn === "function") {
    return ingestExternalUserTurn(payload);
  }
  return { ok: false, code: "ingest_unavailable", message: "ingestExternalUserTurn is missing" };
}

/**
 * @param {string} pluginId
 * @param {string} accountId
 * @param {unknown[]} accountMessages
 * @param {import("@wclaw/plugin-sdk").PluginRuntimeExtensionDeps["ingestExternalUserTurn"] | undefined} ingestExternalUserTurn
 */
async function maybeIngestInboundForAccount(pluginId, accountId, accountMessages, ingestExternalUserTurn) {
  if (!Array.isArray(accountMessages)) return;
  if (typeof ingestExternalUserTurn !== "function") return;
  const inbound = accountMessages.filter((m) => m && m.direction !== "outbound");
  if (inbound.length === 0) return;
  /** 进编排的 user 正文：仅对方发来的纯文本，不带 userId 等前缀（`wxReplyTo` 在 metadata 中）。 */
  const userText = inbound
    .map((msg) => String(msg.text ?? "").trim())
    .filter((t) => t.length > 0)
    .join("\n")
    .trim();
  if (!userText) return;
  const sessionId = accountSessionId(pluginId, accountId);
  const ref = inbound[0]?.id != null ? String(inbound[0].id) : `${accountId}:${Date.now()}`;
  const last = inbound[inbound.length - 1];
  const wxReplyTo =
    last?.userId != null && String(last.userId).length > 0 ? String(last.userId) : undefined;
  const payload = {
    sessionId,
    userText,
    traceId: `poll-inbox:${accountId}:${ref}`,
    source: { kind: "weixin.inbound", ref },
    metadata: {
      accountId,
      messageCount: inbound.length,
      ...(wxReplyTo ? { wxReplyTo } : {})
    }
  };
  const result = await invokeExternalIngest(payload, ingestExternalUserTurn);
  if (!result.ok) {
    console.warn(`[weixin-bridge][${pluginId}] external ingest failed`, result.code, result.message);
  }
}

export function getScheduledTasks() {
  return [
    {
      taskId: "poll-inbox",
      intervalMs: 3000,
      jitterMs: 500,
      timeoutMs: 8000,
      maxRetry: 2,
      backoff: { type: "exponential", baseMs: 300, maxMs: 2000 },
      enabled: true
    }
  ];
}

/**
 * @param {string} pluginId
 * @param {string} taskId
 * @param {import("@wclaw/plugin-sdk").PluginScheduledTaskContext} ctx
 * @param {((input: import("@wclaw/plugin-sdk").PluginHostPublishInput) => void) | undefined} publish
 * @param {{
 *   ingestExternalUserTurn?: import("@wclaw/plugin-sdk").PluginRuntimeExtensionDeps["ingestExternalUserTurn"];
 * }} bridges
 */
export async function runScheduledTask(pluginId, taskId, ctx, publish, bridges) {
  const { ingestExternalUserTurn } = bridges ?? {};
  if (taskId !== "poll-inbox") return;
  console.log("runScheduledTask", taskId, ctx);
  const { config = {} } = ctx;
  const pollInterval = toNumber(config.pollIntervalMs, 3000);
  const timeoutMs = toNumber(config.pollTimeoutMs, 5000);
  const maxAccountsPerTick = toNumber(config.maxPollAccountsPerTick, 5);

  const accounts = await listAccounts();
  try {
    const pollResult = await pollStartedAccountsOnce(timeoutMs, maxAccountsPerTick);
    for (const account of accounts.slice(0, Math.max(1, maxAccountsPerTick))) {
      const accountMessages = (pollResult.messages ?? []).filter((m) => m.accountId === account.accountId);
      if (accountMessages.length === 0) continue;
      await maybeIngestInboundForAccount(pluginId, account.accountId, accountMessages, ingestExternalUserTurn);
      receiveNewMessages(publish, pluginId, account.accountId, accountMessages);
    }
  } catch (error) {
    console.warn(
      `[weixin-bridge][${pluginId}] pollStartedAccountsOnce failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (pollInterval < 500) {
    throw new Error("pollIntervalMs too small");
  }
}
