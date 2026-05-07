import type { PluginTurnContext, PluginTurnHandleResult } from "@wclaw/plugin-sdk";
import { toTurnResult } from "@wclaw/plugin-sdk";
import {
  getUserId,
  listAccounts,
  sendMessage,
  startAccount,
  startQr,
  stopAccount,
  waitQr
} from "../adapters/openclaw-runtime.js";
import type { QrStatusEvent } from "../types.js";
import {
  accountIdFromSession,
  accountSessionId,
  normalizeQrUrl,
  parseCommand,
  pendingLoginByPlugin,
  toNumber
} from "./session-state.js";

type ChatContext = {
  ctx: PluginTurnContext;
  pluginId: string;
  sessionId: string;
  message: string;
  config: Record<string, unknown>;
  cmd: string;
  args: string[];
  defaultSessionId: string;
  accountId: string | null;
};

function buildChatContext(pluginId: string, ctx: PluginTurnContext): ChatContext {
  const { sessionId, message, config = {} } = ctx;
  const trimmed = String(message || "").trim();
  const { cmd, args } = parseCommand(trimmed);
  const defaultSessionId = `${pluginId}:default`;
  const accountId = accountIdFromSession(pluginId, sessionId);
  return { ctx, pluginId, sessionId, message, config, cmd, args, defaultSessionId, accountId };
}

async function handleHelp(c: ChatContext): Promise<string> {
  const { sessionId, defaultSessionId } = c;
  if (sessionId === defaultSessionId) {
    return "可用命令：/login、/accounts、/help。/login 需在支持流式（SSE）的 Chat 中执行，连接保持至扫码流程结束。";
  }
  return "可用命令：/accounts、/send <to> <text>、/logout、/help";
}

async function handleLogin(c: ChatContext): Promise<string | PluginTurnHandleResult> {
  const { ctx, pluginId, sessionId, config } = c;
  const pending = pendingLoginByPlugin.get(pluginId);
  if (pending?.sessionKey) {
    return `登录进行中：请等待当前流程结束后再试。\n二维码链接：${pending.qrCodeUrl ?? "（未返回）"}`;
  }

  const emitAct = ctx.emitPluginActivity;
  if (!emitAct) {
    return "请使用支持流式对话的界面执行 /login（需保持连接直至扫码完成）。\n也可调用 POST /api/ai/chat 并携带 Accept: text/event-stream。";
  }

  const qr = await startQr();
  const qrCodeUrl = normalizeQrUrl(qr);
  pendingLoginByPlugin.set(pluginId, { sessionKey: qr.sessionKey, qrCodeUrl, sessionId });

  const timeoutMs = toNumber(config.loginWaitTimeoutMs, 480000);
  const notifyLoginStatus = (event: QrStatusEvent): void => {
    switch (event.type) {
      case "scanned":
        emitAct({
          phase: "login_scanned",
          data: { summary: "已扫码，请在微信中确认登录…" }
        });
        break;
      case "qr_refreshed": {
        const n = event.refreshCount;
        const url = typeof event.qrcodeUrl === "string" ? event.qrcodeUrl : "";
        emitAct({
          phase: "login_qr_refreshed",
          data: {
            refreshCount: event.refreshCount,
            qrcodeUrl: event.qrcodeUrl,
            summary: `二维码已刷新（第 ${typeof n === "number" ? n : "?"} 次），请重新扫码：\n${url}`
          }
        });
        break;
      }
      default:
        break;
    }
  };

  try {
    const intro = "请使用微信扫码登录（连接将保持至此流程结束）";
    emitAct({
      phase: "login_qr",
      data: {
        qrcodeUrl: qrCodeUrl,
        summary: `${intro}\n${qrCodeUrl || "（未返回二维码链接）"}`
      }
    });

    const result = await waitQr(qr.sessionKey, {
      timeoutMs,
      onStatus: notifyLoginStatus
    });
    if (!result?.connected || !result.accountId) {
      return `登录未完成：${result?.message ?? "未知原因"}`;
    }

    const loggedInAccountId = String(result.accountId);
    await startAccount(loggedInAccountId);
    const accSessionId = accountSessionId(pluginId, loggedInAccountId);
    return toTurnResult(`登录成功：${loggedInAccountId}。已创建会话「${accSessionId}」。`, {
      continue: false,
      persist: [
        {
          sessionId: accSessionId,
          role: "assistant",
          content: `账号 ${loggedInAccountId} 已连接。发送 /send <联系人> <内容> 可发消息。`
        }
      ]
    });
  } catch (error) {
    return `登录流程异常：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    pendingLoginByPlugin.delete(pluginId);
  }
}

async function handleLogout(c: ChatContext): Promise<string> {
  const { accountId } = c;
  if (!accountId) {
    return "当前不在账号会话，无需退出。请先 /login。";
  }
  await stopAccount(accountId);
  return `账号 ${accountId} 已退出当前会话。可在默认会话执行 /login 重新登录。`;
}

async function handleAccounts(): Promise<string> {
  const rows = await listAccounts();
  if (rows.length === 0) {
    return "暂无账号，请先执行 /login";
  }
  return `账号列表：${rows.map((x) => `${x.accountId}`).join("、")}`;
}

async function handleSend(c: ChatContext): Promise<string> {
  const { args, accountId } = c;
  console.log("accountId", accountId);
  if (!accountId) {
    return "当前不在账号会话，请先 /login 并切换到对应账号会话。";
  }
  const text = args[0]??'';
  if ( !text) {
    return "用法：/send  <内容>";
  }
  const userId = await getUserId({ accountId });
  await sendMessage({ accountId, to: userId, text });
  return `已发送： ${text}`;
}

function handlePlainFallback(c: ChatContext): string {
  const { sessionId, message, defaultSessionId } = c;
  if (sessionId === defaultSessionId) {
    return "当前是默认会话：请先执行 /login 登录账号。可输入 /help 查看命令。";
  }
  return `已收到：${message}\n可输入 /help 查看命令。`;
}

const COMMAND_HANDLERS = new Map<
  string,
  (c: ChatContext) => Promise<string | PluginTurnHandleResult>
>([
  ["help", handleHelp],
  ["login", handleLogin],
  ["logout", handleLogout],
  ["accounts", handleAccounts],
  ["send", handleSend]
]);

function isTurnHandleResultLike(value: unknown): value is PluginTurnHandleResult {
  return typeof value === "object" && value !== null && "text" in value;
}

export async function handleChatTurn(pluginId: string, ctx: PluginTurnContext): Promise<PluginTurnHandleResult> {
  const c = buildChatContext(pluginId, ctx);
  const handler = COMMAND_HANDLERS.get(c.cmd);
  if (handler) {
    const output = await handler(c);
    if (isTurnHandleResultLike(output)) {
      return output;
    }
    return toTurnResult(output, { continue: false });
  }
  return toTurnResult(handlePlainFallback(c), { continue: false });
}
