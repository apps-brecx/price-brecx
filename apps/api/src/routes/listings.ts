import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const createSchema = z.object({
  skuId: z.string(),
  connectionId: z.string(),
  marketplaceSku: z.string(),
  currentPrice: z.number().nonnegative(),
  stockAvailable: z.number().int().nonnegative().optional(),
  fulfillment: z.string().optional(),
  url: z.string().url().optional(),
});

const priceSchema = z.object({
  price: z.number().nonnegative(),
  reason: z.string().optional(),
});

export const listingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const listings = await prisma.listing.findMany({
      where: { sku: { workspaceId: req.workspaceId! } },
      include: { sku: { include: { product: true } }, connection: true },
      orderBy: { lastUpdated: 'desc' },
    });
    return listings;
  });

  app.post('/', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const [sku, conn] = await Promise.all([
      prisma.sKU.findFirst({ where: { id: body.skuId, workspaceId: req.workspaceId! } }),
      prisma.marketplaceConnection.findFirst({ where: { id: body.connectionId, workspaceId: req.workspaceId! } }),
    ]);
    if (!sku || !conn) return reply.code(400).send({ error: 'Invalid sku/connection' });
    try {
      const listing = await prisma.listing.create({ data: body });
      return listing;
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(409).send({ error: 'Listing already exists' });
      throw e;
    }
  });

  app.patch('/:id/price', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = priceSchema.parse(req.body);
    const listing = await prisma.listing.findFirst({
      where: { id, sku: { workspaceId: req.workspaceId! } },
    });
    if (!listing) return reply.code(404).send({ error: 'Not found' });

    const oldPrice = listing.currentPrice;
    const updated = await prisma.listing.update({
      where: { id },
      data: { currentPrice: body.price },
    });
    await prisma.priceHistory.create({
      data: {
        listingId: id,
        oldPrice,
        newPrice: body.price,
        trigger: 'MANUAL',
        triggeredBy: req.userId,
        status: 'SUCCESS',
      },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'price.changed',
      description: `Updated price to ${body.price}${body.reason ? ' — ' + body.reason : ''}`,
      metadata: { listingId: id, oldPrice, newPrice: body.price },
    });
    return updated;
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const listing = await prisma.listing.findFirst({
      where: { id, sku: { workspaceId: req.workspaceId! } },
    });
    if (!listing) return reply.code(404).send({ error: 'Not found' });
    await prisma.listing.delete({ where: { id } });
    return { ok: true };
  });
};
