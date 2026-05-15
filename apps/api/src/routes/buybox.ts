import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

export const buyboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const listings = await prisma.listing.findMany({
      where: {
        sku: { workspaceId: req.workspaceId! },
        connection: { marketplace: 'AMAZON' },
      },
      include: { sku: { include: { product: true } }, connection: true },
      orderBy: { lastUpdated: 'desc' },
    });
    const stats = listings.reduce(
      (acc, l) => {
        acc.total++;
        if (l.buyboxOwner === 'us' || l.buyboxOwner === null) acc.won++;
        else acc.lost++;
        if (l.autoReprice) acc.autoReprice++;
        return acc;
      },
      { total: 0, won: 0, lost: 0, autoReprice: 0 }
    );
    return { stats, listings };
  });

  app.patch('/:listingId/auto', async (req, reply) => {
    const { listingId } = req.params as { listingId: string };
    const body = z.object({ autoReprice: z.boolean() }).parse(req.body);
    const listing = await prisma.listing.findFirst({
      where: { id: listingId, sku: { workspaceId: req.workspaceId! } },
    });
    if (!listing) return reply.code(404).send({ error: 'Not found' });
    return prisma.listing.update({ where: { id: listingId }, data: { autoReprice: body.autoReprice } });
  });

  app.post('/:listingId/reprice', async (req, reply) => {
    const { listingId } = req.params as { listingId: string };
    const body = z.object({ price: z.number().nonnegative() }).parse(req.body);
    const listing = await prisma.listing.findFirst({
      where: { id: listingId, sku: { workspaceId: req.workspaceId! } },
    });
    if (!listing) return reply.code(404).send({ error: 'Not found' });
    const oldPrice = listing.currentPrice;
    const updated = await prisma.listing.update({
      where: { id: listingId },
      data: { currentPrice: body.price, buyboxPrice: body.price },
    });
    await prisma.priceHistory.create({
      data: {
        listingId,
        oldPrice,
        newPrice: body.price,
        trigger: 'BUYBOX',
        triggeredBy: req.userId,
        status: 'SUCCESS',
      },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'buybox.reprice',
      description: `Repriced for Buy Box at ${body.price}`,
    });
    return updated;
  });
};
