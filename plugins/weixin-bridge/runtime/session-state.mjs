/** 同源共享的进程内会话辅助状态（与 SQLite 会话消息独立） */

export const pendingLoginByPlugin = new Map();

export function parseCommand(line) {
  const parts = String(line || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { cmd: parts[0] ?? "", args: parts.slice(1) };
}

export function accountSessionId(pluginId, accountId) {
  return `${pluginId}:account-${accountId}`;
}

export function accountIdFromSession(pluginId, sessionId) {
  const prefix = `${pluginId}:account-`;
  if (!String(sessionId).startsWith(prefix)) return null;
  return String(sessionId).slice(prefix.length);
}

export function toNumber(x, fallback) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export function normalizeQrUrl(qr) {
  return qr?.qrCodeUrl ?? qr?.qrcodeUrl ?? "";
}
