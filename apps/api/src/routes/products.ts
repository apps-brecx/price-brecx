import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';
import { logActivity } from '../lib/activity';

const createSchema = z.object({
  name: z.string().min(1),
  basePrice: z.number().nonnegative(),
  imageUrl: z.string().url().optional(),
  description: z.string().optional(),
});

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const { search, page = '1', pageSize = '50' } = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId! };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
          skus: {
            include: {
              listings: { include: { connection: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return { total, items };
  });

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const product = await prisma.product.findFirst({
      where: { id, workspaceId: req.workspaceId! },
      include: { skus: { include: { listings: { include: { connection: true } } } } },
    });
    if (!product) return reply.code(404).send({ error: 'Not found' });
    return product;
  });

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    const product = await prisma.product.create({
      data: { ...body, workspaceId: req.workspaceId! },
    });
    await logActivity({
      workspaceId: req.workspaceId!,
      userId: req.userId,
      type: 'product.created',
      description: `Created product ${product.name}`,
    });
    return product;
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.product.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.product.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.product.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.product.delete({ where: { id } });
    return { ok: true };
  });
};
