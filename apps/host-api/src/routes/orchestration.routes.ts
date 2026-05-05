import type { FastifyInstance } from "fastify";
import { AppError } from "../core/app-error.js";
import { ERROR_CODES } from "../core/error-codes.js";
import { ok } from "../core/response.js";
import { grantLease, revokeLease } from "../services/orchestration/orchestration-lease.service.js";
import { listSchedulerEvents } from "../services/scheduler/scheduler-observer.service.js";
import { getSchedulerSnapshot } from "../services/scheduler/scheduler-runner.service.js";

type GrantLeaseBody = {
  pluginId: string;
  taskId: string;
  ownerId: string;
  ttlMs?: number;
};

type RevokeLeaseBody = {
  leaseId: string;
  ownerId: string;
};

export async function registerOrchestrationRoutes(app: FastifyInstance) {
  app.post<{ Body: GrantLeaseBody }>("/api/orchestration/lease/grant", async (request) => {
    const body = request.body;
    if (!body?.pluginId || !body?.taskId || !body?.ownerId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "pluginId/taskId/ownerId is required", 400);
    }
    const data = grantLease({
      pluginId: body.pluginId,
      taskId: body.taskId,
      ownerId: body.ownerId,
      ttlMs: body.ttlMs ?? 30_000
    });
    return ok(data, request.id);
  });

  app.post<{ Body: RevokeLeaseBody }>("/api/orchestration/lease/revoke", async (request) => {
    const body = request.body;
    if (!body?.leaseId || !body?.ownerId) {
      throw new AppError(ERROR_CODES.INVALID_REQUEST, "leaseId/ownerId is required", 400);
    }
    return ok(revokeLease(body.leaseId, body.ownerId), request.id);
  });

  app.get("/api/orchestration/scheduler/status", async (request) => {
    return ok(
      {
        ...getSchedulerSnapshot(),
        events: listSchedulerEvents(50)
      },
      request.id
    );
  });
}

