import type { QrStartResult } from "../types.js";

export type PendingLoginState = {
  sessionKey: string;
  qrCodeUrl: string;
  sessionId: string;
};

/** 同源共享的进程内会话辅助状态（与 SQLite 会话消息独立） */
export const pendingLoginByPlugin = new Map<string, PendingLoginState>();

export function parseCommand(line: string): { cmd: string; args: string[] } {
  const parts = String(line || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { cmd: parts[0] ?? "", args: parts.slice(1) };
}

export function accountSessionId(pluginId: string, accountId: string): string {
  return `${pluginId}:account-${accountId}`;
}

export function accountIdFromSession(pluginId: string, sessionId: string): string | null {
  const prefix = `${pluginId}:account-`;
  if (!String(sessionId).startsWith(prefix)) return null;
  return String(sessionId).slice(prefix.length);
}

export function toNumber(x: unknown, fallback: number): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export function normalizeQrUrl(qr: QrStartResult): string {
  return qr?.qrCodeUrl ?? qr?.qrcodeUrl ?? "";
}
