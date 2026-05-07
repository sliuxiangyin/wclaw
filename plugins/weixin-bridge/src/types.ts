import type { ExternalUserTurnInput, PluginHostPublishInput } from "@wclaw/plugin-sdk";

export type Account = {
  accountId: string;
  configured?: boolean;
  userId?: string;
};

export type QrStartResult = {
  sessionKey: string;
  qrCodeUrl?: string;
  qrcodeUrl?: string;
};

export type QrStatusEvent =
  | { type: "scanned" }
  | { type: "qr_refreshed"; refreshCount?: number; qrcodeUrl?: string };

export type QrWaitResult = {
  connected?: boolean;
  accountId?: string;
  message?: string;
};

export type SendMessageInput = {
  accountId: string;
  to: string;
  text: string;
};

export type PolledMessage = {
  id?: string | number;
  at?: string;
  text?: string;
  direction?: "outbound" | "inbound" | string;
  accountId?: string;
  userId?: string;
};

export type PollOnceResult = {
  processed: number;
  messages?: PolledMessage[];
};

export type PollStartedAccountsResult = {
  accountCount: number;
  processed: number;
  messages: PolledMessage[];
};

export type OpenclawStandaloneRuntime = {
  startQr: (accountId?: string) => Promise<QrStartResult>;
  waitQr: (
    sessionKey: string,
    options?: { timeoutMs?: number; onStatus?: (event: QrStatusEvent) => void }
  ) => Promise<QrWaitResult>;
  listAccounts: () => Promise<Account[]>;
  startAccount: (accountId: string) => Promise<unknown>;
  stopAccount: (accountId: string) => Promise<unknown>;
  sendMessage: (input: SendMessageInput) => Promise<unknown>;
  getAccountConfig: (input: {
    accountId: string;
    userId?: string;
    contextToken?: string;
  }) => Promise<unknown>;
  getUserId: (input: { accountId: string }) => Promise<string>;
  pollAccountOnce: (input: { accountId: string; timeoutMs: number }) => Promise<PollOnceResult>;
};

export type IngestBridge = (payload: ExternalUserTurnInput) => Promise<{ ok: boolean; code?: string; message?: string }>;
export type PublishBridge = ((input: PluginHostPublishInput) => void) | undefined;
