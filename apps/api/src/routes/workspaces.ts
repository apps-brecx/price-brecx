import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/auth';

const updateSchema = z.object({ name: z.string().min(1).optional(), plan: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']).optional() });

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: req.userId!, workspaceId: id } },
      include: { workspace: true },
    });
    if (!membership) return reply.code(403).send({ error: 'Forbidden' });
    return membership.workspace;
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: req.userId!, workspaceId: id } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const ws = await prisma.workspace.update({ where: { id }, data: body });
    return ws;
  });
};
