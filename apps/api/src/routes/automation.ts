import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['COMPETITOR_BASED', 'STOCK_BASED', 'TIME_BASED', 'BUYBOX', 'CUSTOM']),
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']).optional(),
  matchMode: z.enum(['ALL', 'ANY']).optional(),
  conditions: z.array(z.any()),
  adjustment: z.object({ type: z.enum(['percent', 'amount', 'absolute']), value: z.number() }),
  schedule: z.any().optional(),
  affectedSkus: z.array(z.string()),
});

export const automationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    return prisma.automationRule.findMany({
      where: { workspaceId: req.workspaceId! },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rule = await prisma.automationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!rule) return reply.code(404).send({ error: 'Not found' });
    return rule;
  });

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    const rule = await prisma.automationRule.create({
      data: {
        ...body,
        workspaceId: req.workspaceId!,
        createdBy: req.userId!,
        status: body.status ?? 'ACTIVE',
        matchMode: body.matchMode ?? 'ALL',
      },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'automation.created',
      description: `Created automation "${body.name}"`,
    });
    return rule;
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.automationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.automationRule.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.automationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.automationRule.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rule = await prisma.automationRule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!rule) return reply.code(404).send({ error: 'Not found' });
    const updated = await prisma.automationRule.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'automation.run',
      description: `Ran automation "${rule.name}"`,
    });
    return updated;
  });
};
