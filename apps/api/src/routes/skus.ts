import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const createSchema = z.object({
  productId: z.string(),
  sku: z.string().min(1),
  asin: z.string().optional(),
  upc: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).optional(),
  favorite: z.boolean().optional(),
  fbaPrice: z.number().optional(),
  fbmPrice: z.number().optional(),
  shelves: z.number().int().optional(),
  fbmCount: z.number().int().optional(),
});

const bulkSchema = z.object({
  skuIds: z.array(z.string()).min(1),
  action: z.enum(['delete', 'activate', 'deactivate', 'favorite', 'unfavorite', 'tag', 'untag']),
  tagId: z.string().optional(),
});

export const skuRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const q = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId! };
    if (q.status) where.status = q.status;
    if (q.favorite === 'true') where.favorite = true;
    if (q.search) {
      where.OR = [
        { sku: { contains: q.search, mode: 'insensitive' } },
        { asin: { contains: q.search, mode: 'insensitive' } },
        { product: { name: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    if (q.tag) where.tags = { some: { tagId: q.tag } };

    const take = Math.min(Number(q.pageSize ?? 50), 200);
    const skip = (Math.max(Number(q.page ?? 1), 1) - 1) * take;
    const [total, items] = await Promise.all([
      prisma.sKU.count({ where }),
      prisma.sKU.findMany({
        where,
        include: {
          product: true,
          listings: { include: { connection: true } },
          tags: { include: { tag: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return {
      total,
      items: items.map((s) => ({
        ...s,
        tags: s.tags.map((t) => t.tag),
      })),
    };
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sku = await prisma.sKU.findFirst({
      where: { id, workspaceId: req.workspaceId! },
      include: {
        product: true,
        listings: {
          include: {
            connection: true,
            priceHistory: { orderBy: { changedAt: 'desc' }, take: 30 },
          },
        },
        schedules: { orderBy: { startAt: 'desc' }, take: 20 },
        tags: { include: { tag: true } },
      },
    });
    if (!sku) return reply.code(404).send({ error: 'Not found' });
    return { ...sku, tags: sku.tags.map((t) => t.tag) };
  });

  app.post('/', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: body.productId, workspaceId: req.workspaceId! } });
    if (!product) return reply.code(400).send({ error: 'Product not in workspace' });
    try {
      const sku = await prisma.sKU.create({
        data: { ...body, workspaceId: req.workspaceId! },
      });
      await logActivity({
        workspaceId: req.workspaceId!,
        userId: req.userId,
        type: 'sku.created',
        description: `Created SKU ${sku.sku}`,
      });
      return sku;
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(409).send({ error: 'SKU already exists' });
      throw e;
    }
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.sKU.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.sKU.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.sKU.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.sKU.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/bulk-action', async (req) => {
    const body = bulkSchema.parse(req.body);
    const skus = await prisma.sKU.findMany({
      where: { id: { in: body.skuIds }, workspaceId: req.workspaceId! },
      select: { id: true },
    });
    const ids = skus.map((s) => s.id);
    if (ids.length === 0) return { ok: true, affected: 0 };

    switch (body.action) {
      case 'delete':
        await prisma.sKU.deleteMany({ where: { id: { in: ids } } });
        break;
      case 'activate':
        await prisma.sKU.updateMany({ where: { id: { in: ids } }, data: { status: 'ACTIVE' } });
        break;
      case 'deactivate':
        await prisma.sKU.updateMany({ where: { id: { in: ids } }, data: { status: 'INACTIVE' } });
        break;
      case 'favorite':
        await prisma.sKU.updateMany({ where: { id: { in: ids } }, data: { favorite: true } });
        break;
      case 'unfavorite':
        await prisma.sKU.updateMany({ where: { id: { in: ids } }, data: { favorite: false } });
        break;
      case 'tag':
        if (!body.tagId) break;
        await prisma.tagSKU.createMany({
          data: ids.map((skuId) => ({ skuId, tagId: body.tagId! })),
          skipDuplicates: true,
        });
        break;
      case 'untag':
        if (!body.tagId) break;
        await prisma.tagSKU.deleteMany({ where: { skuId: { in: ids }, tagId: body.tagId } });
        break;
    }
    return { ok: true, affected: ids.length };
  });

  app.get('/:id/history', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sku = await prisma.sKU.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!sku) return reply.code(404).send({ error: 'Not found' });
    const history = await prisma.priceHistory.findMany({
      where: { listing: { skuId: id } },
      orderBy: { changedAt: 'desc' },
      include: { listing: { include: { connection: true } } },
      take: 200,
    });
    return history;
  });
};
