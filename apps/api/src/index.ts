import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { SESSION_COOKIE } from "@fbm/shared";

import { env } from "./env.js";
import { logger } from "./logger.js";
import { initSentry, captureError } from "./sentry.js";
import { pingDatabase } from "./db.js";
import { startJobs, stopJobs } from "./jobs.js";
import { addSocket } from "./ws.js";
import { resolveSession } from "./auth/sessions.js";
import authPlugin from "./auth/plugin.js";

import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import skuRoutes from "./routes/skus.js";
import productRoutes from "./routes/products.js";
import scheduleRoutes from "./routes/schedules.js";
import automationRoutes from "./routes/automation.js";
import alertRoutes from "./routes/alerts.js";
import notificationRuleRoutes from "./routes/notificationRules.js";
import activityRoutes from "./routes/activity.js";
import historyRoutes from "./routes/history.js";
import reportRoutes from "./routes/reports.js";
import dashboardRoutes from "./routes/dashboard.js";
import navCountsRoutes from "./routes/navCounts.js";
import marketplaceRoutes from "./routes/marketplaces.js";
import inventoryRoutes from "./routes/inventory.js";
import settingsRoutes from "./routes/settings.js";
import uploadRoutes from "./routes/uploads.js";

initSentry();

const app = Fastify({ logger, trustProxy: true });

await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
  credentials: true,
});
await app.register(cookie, { secret: env.SESSION_SECRET });
await app.register(websocket);
await app.register(authPlugin);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "Validation failed", issues: err.issues });
  }
  logger.error({ err }, "request error");
  captureError(err);
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  return reply
    .code(status)
    .send({ error: status >= 500 ? "Internal Server Error" : err.message });
});

app.get("/health", async () => ({
  ok: true,
  db: await pingDatabase(),
  ts: new Date().toISOString(),
}));
app.get("/", async () => ({ service: "fbm-api", status: "running" }));

const api: FastifyPluginAsync = async (instance: FastifyInstance) => {
  await instance.register(authRoutes);
  await instance.register(meRoutes);
  await instance.register(skuRoutes);
  await instance.register(productRoutes);
  await instance.register(scheduleRoutes);
  await instance.register(automationRoutes);
  await instance.register(alertRoutes);
  await instance.register(notificationRuleRoutes);
  await instance.register(activityRoutes);
  await instance.register(historyRoutes);
  await instance.register(reportRoutes);
  await instance.register(dashboardRoutes);
  await instance.register(navCountsRoutes);
  await instance.register(marketplaceRoutes);
  await instance.register(inventoryRoutes);
  await instance.register(settingsRoutes);
  await instance.register(uploadRoutes);
};
await app.register(api, { prefix: "/api" });

// Realtime channel — authenticated via the session cookie.
app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, async (socket, req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = await resolveSession(token);
    if (!user) {
      socket.close(4401, "Unauthorized");
      return;
    }
    addSocket(user.workspaceId, socket);
    socket.send(JSON.stringify({ type: "connected" }));
  });
});

async function main() {
  try {
    await startJobs();
  } catch (err) {
    logger.error({ err }, "pg-boss failed to start (continuing without queue)");
  }
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`API listening on ${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    logger.info(`${sig} received, shutting down`);
    await stopJobs().catch(() => {});
    await app.close();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  captureError(err);
  process.exit(1);
});
