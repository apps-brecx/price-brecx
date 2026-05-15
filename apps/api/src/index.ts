import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { env } from './lib/env';
import './lib/types';

import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { workspaceRoutes } from './routes/workspaces';
import { marketplaceRoutes } from './routes/marketplaces';
import { productRoutes } from './routes/products';
import { skuRoutes } from './routes/skus';
import { listingRoutes } from './routes/listings';
import { inventoryRoutes } from './routes/inventory';
import { scheduleRoutes } from './routes/schedules';
import { automationRoutes } from './routes/automation';
import { buyboxRoutes } from './routes/buybox';
import { alertRoutes } from './routes/alerts';
import { notificationRuleRoutes } from './routes/notificationRules';
import { reportRoutes } from './routes/reports';
import { activityRoutes } from './routes/activity';
import { tagRoutes } from './routes/tags';
import { teamRoutes } from './routes/team';
import { apiKeyRoutes } from './routes/apiKeys';
import { webhookRoutes } from './routes/webhooks';
import { dashboardRoutes } from './routes/dashboard';

async function buildServer() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.get('/', async () => ({ message: 'API is running' }));
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(meRoutes, { prefix: '/api/me' });
  await app.register(workspaceRoutes, { prefix: '/api/workspaces' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(marketplaceRoutes, { prefix: '/api/marketplaces' });
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.register(skuRoutes, { prefix: '/api/skus' });
  await app.register(listingRoutes, { prefix: '/api/listings' });
  await app.register(inventoryRoutes, { prefix: '/api/inventory' });
  await app.register(scheduleRoutes, { prefix: '/api/schedules' });
  await app.register(automationRoutes, { prefix: '/api/automation' });
  await app.register(buyboxRoutes, { prefix: '/api/buybox' });
  await app.register(alertRoutes, { prefix: '/api/alerts' });
  await app.register(notificationRuleRoutes, { prefix: '/api/notification-rules' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(activityRoutes, { prefix: '/api/activity-log' });
  await app.register(tagRoutes, { prefix: '/api/tags' });
  await app.register(teamRoutes, { prefix: '/api/team' });
  await app.register(apiKeyRoutes, { prefix: '/api/api-keys' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const status = (err as any).statusCode ?? 500;
    reply.code(status).send({ error: (err as Error).message ?? 'Internal error' });
  });

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
