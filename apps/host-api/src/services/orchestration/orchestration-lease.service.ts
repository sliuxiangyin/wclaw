type LeaseRecord = {
  leaseId: string;
  pluginId: string;
  taskId: string;
  ownerId: string;
  expireAt: number;
};

type GrantInput = {
  pluginId: string;
  taskId: string;
  ownerId: string;
  ttlMs: number;
};

const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 300_000;

const leaseByKey = new Map<string, LeaseRecord>();
const leaseById = new Map<string, LeaseRecord>();

function makeKey(pluginId: string, taskId: string): string {
  return `${pluginId}\0${taskId}`;
}

function cleanupExpired(now = Date.now()) {
  for (const [leaseId, record] of leaseById) {
    if (record.expireAt <= now) {
      leaseById.delete(leaseId);
      leaseByKey.delete(makeKey(record.pluginId, record.taskId));
    }
  }
}

export function grantLease(input: GrantInput) {
  const now = Date.now();
  cleanupExpired(now);

  const ttlMs = Math.max(1_000, Math.min(input.ttlMs || DEFAULT_TTL_MS, MAX_TTL_MS));
  const key = makeKey(input.pluginId, input.taskId);
  const hit = leaseByKey.get(key);

  if (hit && hit.ownerId !== input.ownerId) {
    return {
      granted: false,
      leaseId: hit.leaseId,
      expireAt: new Date(hit.expireAt).toISOString()
    };
  }

  const leaseId = hit?.leaseId ?? `${input.ownerId}:${input.pluginId}:${input.taskId}:${now}`;
  const expireAt = now + ttlMs;
  const record: LeaseRecord = {
    leaseId,
    pluginId: input.pluginId,
    taskId: input.taskId,
    ownerId: input.ownerId,
    expireAt
  };

  leaseByKey.set(key, record);
  leaseById.set(leaseId, record);

  return {
    granted: true,
    leaseId,
    expireAt: new Date(expireAt).toISOString()
  };
}

export function revokeLease(leaseId: string, ownerId: string) {
  cleanupExpired();
  const hit = leaseById.get(leaseId);
  if (!hit || hit.ownerId !== ownerId) {
    return { revoked: false };
  }
  leaseById.delete(leaseId);
  leaseByKey.delete(makeKey(hit.pluginId, hit.taskId));
  return { revoked: true };
}

