import { WeixinStandaloneRuntime } from "./openclaw-weixin/dist/src/standalone/runtime.js";

const runtime = new WeixinStandaloneRuntime();

/**
 * @typedef {Object} Account
 * @property {string} accountId
 * @property {boolean} configured
 * @property {string=} userId
 */



export async function startQr(accountId) {
  return runtime.startQr(accountId);
}

export async function waitQr(sessionKey, options) {
  return runtime.waitQr(sessionKey, options);
}

/** @returns {Promise<Account[]>} */
export async function listAccounts() {
  const lists = await runtime.listAccounts();
  return lists;
}

export async function startAccount(accountId) {
  return runtime.startAccount(accountId);
}

export async function stopAccount(accountId) {
  await runtime.stopAccount(accountId);
  return { ok: true };
}

export async function sendMessage(input) {
  return runtime.sendMessage(input);
}

export async function getAccountConfig(input) {
  const { accountId, userId, contextToken } = input;
  return runtime.getAccountConfig({ accountId, userId, contextToken });
}

/**
 * 轮询账号收件箱一次：
 * - 返回每轮处理的账号数与新增消息数
 * - `messages` 仅包含本轮 `pollAccountOnce` 新增入库的消息明细（非历史查询）
 */
export async function pollStartedAccountsOnce(timeoutMs = 5000, maxAccountsPerTick = 5) {
 
  const rows = await runtime.listAccounts();
  const accountIds = rows.map((x) => String(x.accountId));
  const cappedIds = accountIds.slice(0, Math.max(1, Number(maxAccountsPerTick) || 1));
  let processed = 0;
  const messages = [];
  for (const accountId of cappedIds) {
    const result = await runtime.pollAccountOnce({ accountId, timeoutMs });
    processed += result.processed;
    if (Array.isArray(result.messages) && result.messages.length > 0) {
      messages.push(...result.messages);
    }
  }
  return { accountCount: cappedIds.length, processed, messages };
}
