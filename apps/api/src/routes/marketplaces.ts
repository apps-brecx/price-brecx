import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const marketplaceEnum = z.enum(['AMAZON', 'WALMART', 'SHOPIFY', 'TIKTOK', 'EBAY', 'ETSY', 'FAIRE']);

const createSchema = z.object({
  marketplace: marketplaceEnum,
  displayName: z.string().optional(),
  region: z.string().optional(),
  sellerId: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  metadata: z.any().optional(),
});

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const list = await prisma.marketplaceConnection.findMany({
      where: { workspaceId: req.workspaceId! },
      include: { _count: { select: { listings: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((m) => ({
      id: m.id,
      marketplace: m.marketplace,
      displayName: m.displayName,
      region: m.region,
      status: m.status,
      sellerId: m.sellerId,
      lastSyncAt: m.lastSyncAt,
      listingCount: m._count.listings,
      createdAt: m.createdAt,
    }));
  });

  app.post('/', async (req, reply) => {
    const body = createSchema.parse(req.body);
    try {
      const conn = await prisma.marketplaceConnection.create({
        data: {
          workspaceId: req.workspaceId!,
          marketplace: body.marketplace,
          displayName: body.displayName,
          region: body.region,
          sellerId: body.sellerId,
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          metadata: body.metadata,
          status: body.accessToken ? 'CONNECTED' : 'PENDING',
        },
      });
      await logActivity({
        workspaceId: req.workspaceId!,
        userId: req.userId,
        type: 'marketplace.connected',
        description: `Connected ${body.marketplace}${body.region ? ' (' + body.region + ')' : ''}`,
      });
      return conn;
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(409).send({ error: 'Already connected' });
      throw e;
    }
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.marketplaceConnection.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    const conn = await prisma.marketplaceConnection.update({ where: { id }, data: body });
    return conn;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.marketplaceConnection.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.marketplaceConnection.delete({ where: { id } });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'marketplace.disconnected',
      description: `Disconnected ${existing.marketplace}`,
    });
    return { ok: true };
  });

  app.post('/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.marketplaceConnection.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const updated = await prisma.marketplaceConnection.update({
      where: { id },
      data: { lastSyncAt: new Date(), status: 'CONNECTED' },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'marketplace.sync',
      description: `Sync triggered for ${existing.marketplace}`,
    });
    return updated;
  });
};
