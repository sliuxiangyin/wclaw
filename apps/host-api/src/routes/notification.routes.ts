import type { FastifyInstance } from "fastify";
import type { NotificationProvider } from "../providers/notification-provider/index.js";

type NotificationQuery = {
  scope?: "global" | "plugin" | "session";
  pluginId?: string;
  sessionId?: string;
};

export async function registerNotificationRoutes(
  app: FastifyInstance,
  notificationProvider: NotificationProvider
) {
  app.get<{ Querystring: NotificationQuery }>("/api/notifications/stream", async (request, reply) => {
    const origin = request.headers.origin;
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": typeof origin === "string" && origin.length > 0 ? origin : "*",
      Vary: "Origin"
    });

    const scope = request.query.scope ?? "global";
    const pluginId = request.query.pluginId;
    const sessionId = request.query.sessionId;

    const unsubscribe = notificationProvider.subscribe(
      { scope, pluginId, sessionId },
      (event) => {
        reply.raw.write(`id: ${event.id}\n`);
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    );

    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        reply.raw.end();
      } catch {
        // ignore
      }
    });
  });
}
