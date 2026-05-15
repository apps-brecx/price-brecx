import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const createSchema = z.object({
  skuId: z.string(),
  type: z.enum(['SINGLE', 'WEEKLY', 'WEEKLY_REVERT', 'MONTHLY', 'SALE']),
  newPrice: z.number().nonnegative(),
  basePrice: z.number().nonnegative().optional(),
  revertPrice: z.number().nonnegative().optional(),
  timezone: z.string().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  weekdays: z.array(z.string()).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  recurrence: z.string().optional(),
  notes: z.string().optional(),
});

export const scheduleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const q = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId! };
    if (q.status) where.status = q.status;
    if (q.type) where.type = q.type;
    if (q.from || q.to) {
      where.startAt = {};
      if (q.from) where.startAt.gte = new Date(q.from);
      if (q.to) where.startAt.lte = new Date(q.to);
    }
    return prisma.priceSchedule.findMany({
      where,
      include: { sku: { include: { product: true } } },
      orderBy: { startAt: 'asc' },
    });
  });

  app.get('/calendar', async (req) => {
    const q = req.query as Record<string, string>;
    const from = q.from ? new Date(q.from) : new Date();
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    return prisma.priceSchedule.findMany({
      where: {
        workspaceId: req.workspaceId!,
        startAt: { gte: from, lte: to },
      },
      include: { sku: { include: { product: true } } },
      orderBy: { startAt: 'asc' },
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schedule = await prisma.priceSchedule.findFirst({
      where: { id, workspaceId: req.workspaceId! },
      include: { sku: { include: { product: true, listings: { include: { connection: true } } } } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Not found' });
    return schedule;
  });

  app.post('/', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const sku = await prisma.sKU.findFirst({ where: { id: body.skuId, workspaceId: req.workspaceId! } });
    if (!sku) return reply.code(400).send({ error: 'SKU not in workspace' });
    const schedule = await prisma.priceSchedule.create({
      data: {
        workspaceId: req.workspaceId!,
        skuId: body.skuId,
        type: body.type,
        newPrice: body.newPrice,
        basePrice: body.basePrice,
        revertPrice: body.revertPrice,
        timezone: body.timezone ?? 'America/New_York',
        startAt: new Date(body.startAt),
        endAt: body.endAt ? new Date(body.endAt) : null,
        weekdays: body.weekdays ?? [],
        monthDay: body.monthDay,
        recurrence: body.recurrence,
        notes: body.notes,
        createdBy: req.userId!,
      },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'schedule.created',
      description: `Scheduled ${body.type} change for SKU ${sku.sku}`,
    });
    return schedule;
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.priceSchedule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.priceSchedule.update({
      where: { id },
      data: {
        ...body,
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
      },
    });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.priceSchedule.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.priceSchedule.update({ where: { id }, data: { status: 'CANCELLED' } });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'schedule.cancelled',
      description: `Cancelled schedule ${id}`,
    });
    return { ok: true };
  });

  app.post('/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const schedule = await prisma.priceSchedule.findFirst({
      where: { id, workspaceId: req.workspaceId! },
      include: { sku: { include: { listings: true } } },
    });
    if (!schedule) return reply.code(404).send({ error: 'Not found' });

    for (const listing of schedule.sku.listings) {
      const oldPrice = listing.currentPrice;
      await prisma.listing.update({ where: { id: listing.id }, data: { currentPrice: schedule.newPrice } });
      await prisma.priceHistory.create({
        data: {
          listingId: listing.id,
          oldPrice,
          newPrice: schedule.newPrice,
          trigger: 'SCHEDULED',
          scheduleId: schedule.id,
          status: 'SUCCESS',
        },
      });
    }

    const updated = await prisma.priceSchedule.update({
      where: { id },
      data: { status: 'COMPLETED', executedAt: new Date() },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'schedule.executed',
      description: `Executed schedule for SKU ${schedule.sku.sku}`,
    });
    return updated;
  });
};
