import type {
  Account,
  OpenclawStandaloneRuntime,
  PollStartedAccountsResult,
  QrStartResult,
  QrStatusEvent,
  QrWaitResult,
  SendMessageInput
} from "../types.js";

const OPENCLAW_RUNTIME_PATH = "../../openclaw-weixin/dist/src/standalone/runtime.js";
const OPENCLAW_BUILD_HINT =
  "[weixin-bridge] openclaw runtime 未就绪：请先在 plugins/weixin-bridge/openclaw-weixin 下安装并构建（npm install && npm run build），确认 dist/src/standalone/runtime.js 存在。";

let runtimePromise: Promise<OpenclawStandaloneRuntime> | null = null;

async function getRuntime(): Promise<OpenclawStandaloneRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    try {
      const mod = (await import(OPENCLAW_RUNTIME_PATH)) as {
        WeixinStandaloneRuntime?: new () => OpenclawStandaloneRuntime;
      };
      const RuntimeCtor = mod?.WeixinStandaloneRuntime;
      if (typeof RuntimeCtor !== "function") {
        throw new Error(`[weixin-bridge] 导出异常：${OPENCLAW_RUNTIME_PATH} 缺少 WeixinStandaloneRuntime 导出。`);
      }
      return new RuntimeCtor();
    } catch (error) {
      runtimePromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${OPENCLAW_BUILD_HINT}\n原始错误: ${detail}`);
    }
  })();
  return runtimePromise;
}

export async function startQr(accountId?: string): Promise<QrStartResult> {
  const runtime = await getRuntime();
  return runtime.startQr(accountId);
}

export async function waitQr(
  sessionKey: string,
  options?: { timeoutMs?: number; onStatus?: (event: QrStatusEvent) => void }
): Promise<QrWaitResult> {
  const runtime = await getRuntime();
  return runtime.waitQr(sessionKey, options);
}

export async function listAccounts(): Promise<Account[]> {
  const runtime = await getRuntime();
  return runtime.listAccounts();
}

export async function startAccount(accountId: string): Promise<unknown> {
  const runtime = await getRuntime();
  return runtime.startAccount(accountId);
}

export async function stopAccount(accountId: string): Promise<{ ok: true }> {
  const runtime = await getRuntime();
  await runtime.stopAccount(accountId);
  return { ok: true };
}

export async function sendMessage(input: SendMessageInput): Promise<unknown> {
  const runtime = await getRuntime();
  return runtime.sendMessage(input);
}

export async function getAccountConfig(input: {
  accountId: string;
  contextToken?: string;
}): Promise<unknown> {
  const runtime = await getRuntime();
  return runtime.getAccountConfig(input);
}

export async function getUserId(input: { accountId: string }): Promise<string> {
  const runtime = await getRuntime();
  return runtime.getUserId(input);
}

export async function pollStartedAccountsOnce(
  timeoutMs = 5000,
  maxAccountsPerTick = 5
): Promise<PollStartedAccountsResult> {
  const runtime = await getRuntime();
  const rows = await runtime.listAccounts();
  const accountIds = rows.map((x) => String(x.accountId));
  const cappedIds = accountIds.slice(0, Math.max(1, Number(maxAccountsPerTick) || 1));
  let processed = 0;
  const messages: PollStartedAccountsResult["messages"] = [];
  for (const accountId of cappedIds) {
    const result = await runtime.pollAccountOnce({ accountId, timeoutMs });
    processed += result.processed;
    if (Array.isArray(result.messages) && result.messages.length > 0) {
      messages.push(...result.messages);
    }
  }
  return { accountCount: cappedIds.length, processed, messages };
}
