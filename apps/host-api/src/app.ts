import cors from "@fastify/cors";
import Fastify, { FastifyInstance } from "fastify";
import { AppError } from "./core/app-error.js";
import { ERROR_CODES } from "./core/error-codes.js";
import { fail, ok } from "./core/response.js";
import { HostEventHub } from "./providers/host-event-hub-provider/index.js";
import { PluginRuntimeProvider } from "./providers/plugin-runtime-provider/index.js";
import { NotificationProvider } from "./providers/notification-provider/index.js";
import { AiRunProvider } from "./providers/ai-run-provider/index.js";
import { registerAiChatRoutes } from "./routes/ai-chat.routes.js";
import { registerMcpRoutes } from "./routes/mcp.routes.js";
import { createMcpGatewayService } from "./services/mcp-gateway/mcp-gateway.service.js";
import { registerLlmConfigRoutes } from "./routes/llm-config.routes.js";
import { registerNotificationRoutes } from "./routes/notification.routes.js";
import { registerOrchestrationRoutes } from "./routes/orchestration.routes.js";
import { registerPluginChatRoutes } from "./routes/plugin-chat.routes.js";
import { registerPluginConfigRoutes } from "./routes/plugin-config.routes.js";
import { registerPluginsRoutes } from "./routes/plugins.routes.js";
import { registerPluginSpecRoutes } from "./routes/plugin-spec.routes.js";
import { registerPluginIngestAndHostBridge } from "./composition/register-plugin-ingest-and-host-bridge.js";
import { bindPluginCatalogProvider } from "./services/plugin-catalog/plugin-catalog.service.js";
import { bootstrapScheduler, shutdownScheduler } from "./services/scheduler/scheduler-bootstrap.service.js";
import { registerSchedulerNotificationPublisher } from "./services/scheduler/scheduler-observer.service.js";

function resolveCorsOrigin(): boolean | string | RegExp | (string | RegExp)[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function initProvider(app: FastifyInstance, mcpGateway: ReturnType<typeof createMcpGatewayService>) {
  const notificationProvider = new NotificationProvider();
  const aiRunProvider = new AiRunProvider();
  const hostEventHub = new HostEventHub(notificationProvider);
  registerSchedulerNotificationPublisher(hostEventHub.createPublishNotificationStream());
  const pluginRuntimeProvider = await PluginRuntimeProvider.create({
    hostEventHub,
    log: app.log
  });
  registerPluginIngestAndHostBridge(hostEventHub, pluginRuntimeProvider, mcpGateway);
  bindPluginCatalogProvider(pluginRuntimeProvider);
  return { notificationProvider, hostEventHub, pluginRuntimeProvider, aiRunProvider };
}

export async function createApp() {

  const app = Fastify({ logger: true });
  const mcpGateway = createMcpGatewayService();

  await app.register(cors, {
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Wclaw-Plugin-Id", "X-Wclaw-Session-Id"]
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(fail(error.code, error.message, request.id));
      return;
    }
    app.log.error(error);
    reply.status(500).send(fail(ERROR_CODES.INTERNAL_ERROR, "internal server error", request.id));
  });

  app.get("/health", async () => {
    return ok({ status: "ok" }, null);
  });

  const { notificationProvider, hostEventHub, pluginRuntimeProvider, aiRunProvider } = await initProvider(app, mcpGateway);

  void registerLlmConfigRoutes(app);
  void registerMcpRoutes(app, mcpGateway);
  void registerAiChatRoutes(app, pluginRuntimeProvider, aiRunProvider, hostEventHub.createPublishNotificationStream());
  void registerPluginsRoutes(app);
  void registerPluginChatRoutes(app, pluginRuntimeProvider, mcpGateway);
  void registerPluginConfigRoutes(app);
  void registerPluginSpecRoutes(app);
  void registerOrchestrationRoutes(app);
  void registerNotificationRoutes(app, notificationProvider);

  await bootstrapScheduler(pluginRuntimeProvider);
  app.addHook("onClose", async () => {
    shutdownScheduler();
  });

  return app;
}
