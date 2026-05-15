import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const priceTypes = ['PRICE_DRIFT', 'PRICE_STOCK_OUT_SPIKE', 'BUYBOX_LOST', 'COMPETITOR_UNDERCUT', 'INVENTORY_LOW', 'SCHEDULE_FAILED'];
const salesTypes = ['SALES_DROP', 'CONVERSION_DROP', 'REVENUE_DROP', 'SALES_RECOVERY', 'SALES_SPIKE'];

const createSchema = z.object({
  type: z.string(),
  severity: z.enum(['CRITICAL', 'WARNING', 'INFO', 'RESOLVED']),
  title: z.string(),
  description: z.string(),
  metadata: z.any().optional(),
});

export const alertRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  async function list(req: any, kind: 'price' | 'sales' | 'all') {
    const q = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId };
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (kind === 'price') where.type = { in: priceTypes };
    else if (kind === 'sales') where.type = { in: salesTypes };
    return prisma.alert.findMany({ where, orderBy: { triggeredAt: 'desc' }, take: 200 });
  }

  app.get('/', async (req) => list(req, 'all'));
  app.get('/price', async (req) => list(req, 'price'));
  app.get('/sales', async (req) => list(req, 'sales'));

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    return prisma.alert.create({
      data: { ...body, type: body.type as any, workspaceId: req.workspaceId! },
    });
  });

  app.patch('/:id/snooze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ minutes: z.number().int().positive() }).parse(req.body);
    const alert = await prisma.alert.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!alert) return reply.code(404).send({ error: 'Not found' });
    return prisma.alert.update({
      where: { id },
      data: { status: 'SNOOZED', snoozedUntil: new Date(Date.now() + body.minutes * 60_000) },
    });
  });

  app.patch('/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const alert = await prisma.alert.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!alert) return reply.code(404).send({ error: 'Not found' });
    return prisma.alert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  });

  app.patch('/:id/dismiss', async (req, reply) => {
    const { id } = req.params as { id: string };
    const alert = await prisma.alert.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!alert) return reply.code(404).send({ error: 'Not found' });
    return prisma.alert.update({ where: { id }, data: { status: 'DISMISSED' } });
  });
};
