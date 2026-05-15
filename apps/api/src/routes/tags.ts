import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const createSchema = z.object({
  name: z.string().min(1),
  color: z.enum(['blue', 'red', 'green', 'amber', 'purple', 'gray']).optional(),
});

export const tagRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    return prisma.tag.findMany({
      where: { workspaceId: req.workspaceId! },
      include: { _count: { select: { skus: true } } },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/', async (req, reply) => {
    const body = createSchema.parse(req.body);
    try {
      return await prisma.tag.create({
        data: { ...body, workspaceId: req.workspaceId! },
      });
    } catch (e: any) {
      if (e.code === 'P2002') return reply.code(409).send({ error: 'Tag already exists' });
      throw e;
    }
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.tag.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.tag.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.tag.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.tag.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/assign', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tag = await prisma.tag.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!tag) return reply.code(404).send({ error: 'Tag not found' });
    const body = z.object({ skuIds: z.array(z.string()) }).parse(req.body);
    await prisma.tagSKU.createMany({
      data: body.skuIds.map((skuId) => ({ skuId, tagId: id })),
      skipDuplicates: true,
    });
    return { ok: true, assigned: body.skuIds.length };
  });
};
