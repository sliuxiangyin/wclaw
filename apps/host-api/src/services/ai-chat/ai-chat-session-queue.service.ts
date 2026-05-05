const tails = new Map<string, Promise<void>>();

function queueKey(pluginId: string, sessionId: string): string {
  return `${pluginId}\0${sessionId}`;
}

/**
 * 同会话串行队列：
 * - 同 pluginId+sessionId 严格 FIFO
 * - 不同会话互不阻塞
 */
export async function runInSessionQueue<T>(
  pluginId: string,
  sessionId: string,
  task: () => Promise<T>
): Promise<T> {
  const key = queueKey(pluginId, sessionId);
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate);
  tails.set(key, next);

  await prev;
  try {
    return await task();
  } finally {
    release();
    queueMicrotask(() => {
      if (tails.get(key) === next) {
        tails.delete(key);
      }
    });
  }
}

