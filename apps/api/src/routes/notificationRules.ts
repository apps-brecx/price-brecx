import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const createSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['STOCK_ALERT', 'BACK_IN_STOCK', 'WALMART_STOCK', 'PRICE_ALERT', 'SALES_ALERT']),
  active: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
  time: z.string().optional(),
  cadence: z.string().optional(),
  weekdays: z.array(z.string()).optional(),
  matchMode: z.enum(['ALL', 'ANY']).optional(),
  tags: z.array(z.string()).optional(),
  warehouseRules: z.any().optional(),
  emails: z.array(z.string().email()).optional(),
  channels: z.object({
    email: z.boolean().optional(),
    slack: z.boolean().optional(),
    sms: z.boolean().optional(),
    webhook: z.boolean().optional(),
  }),
});

export const notificationRuleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const q = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId! };
    if (q.category) where.category = q.category;
    return prisma.notificationRule.findMany({ where, orderBy: { createdAt: 'desc' } });
  });

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    return prisma.notificationRule.create({
      data: { ...body, workspaceId: req.workspaceId! },
    });
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.notificationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.notificationRule.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.notificationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.notificationRule.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rule = await prisma.notificationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!rule) return reply.code(404).send({ error: 'Not found' });
    await prisma.notificationRule.update({ where: { id }, data: { lastSentAt: new Date() } });
    return { ok: true, sentTo: rule.emails };
  });
};
