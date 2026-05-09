import { AppError } from "../../core/app-error.js";
import { ERROR_CODES } from "../../core/error-codes.js";

const tails = new Map<string, Promise<void>>();
/** 同会话下 Web Chat 是否正在执行 `executeRound`（不含在队列里等前序任务） */
const webTurnActive = new Set<string>();

function sessionTurnKey(pluginId: string, sessionId: string): string {
  return `${pluginId}\0${sessionId}`;
}

const BUSY_MESSAGE = "当前会话正在生成回复，请等待结束后再发送。";

/**
 * Web Chat：`sessionConcurrency === web_fail_fast` 且 `turnSource === web` 时，
 * 若同会话已有一条 Web 轮次正在执行 `executeRound`，立即 409（不进队列）。
 * 进线 `external` 不占 `webTurnActive`；与 Web 交叉时先入队者优先，仍 FIFO。
 */
export function assertWebChatFailFastOrThrow(
  pluginId: string,
  sessionId: string,
  sessionConcurrency: "web_fail_fast" | "queue" | undefined,
  turnSource: "web" | "external" | undefined
): void {
  if (sessionConcurrency !== "web_fail_fast") return;
  if (turnSource !== "web") return;
  const key = sessionTurnKey(pluginId, sessionId);
  if (webTurnActive.has(key)) {
    throw new AppError(ERROR_CODES.CHAT_SESSION_BUSY, BUSY_MESSAGE, 409);
  }
}

export type RunInSessionQueueOptions = {
  turnSource?: "web" | "external";
  sessionConcurrency?: "web_fail_fast" | "queue";
};

/**
 * 同会话串行队列（FIFO）。
 * - `turnSource: web` 时在本 task 内维护 `webTurnActive`，供 Web 快速失败判定。
 */
export async function runInSessionQueue<T>(
  pluginId: string,
  sessionId: string,
  task: () => Promise<T>,
  options?: RunInSessionQueueOptions
): Promise<T> {
  const key = sessionTurnKey(pluginId, sessionId);
  assertWebChatFailFastOrThrow(pluginId, sessionId, options?.sessionConcurrency, options?.turnSource);

  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate);
  tails.set(key, next);

  await prev;
  const markWeb = options?.turnSource === "web";
  try {
    if (markWeb) {
      webTurnActive.add(key);
    }
    try {
      return await task();
    } finally {
      if (markWeb) {
        webTurnActive.delete(key);
      }
    }
  } finally {
    release();
    queueMicrotask(() => {
      if (tails.get(key) === next) {
        tails.delete(key);
      }
    });
  }
}
