import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  active: z.boolean().optional(),
});

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    return prisma.webhook.findMany({
      where: { workspaceId: req.workspaceId! },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    return prisma.webhook.create({
      data: {
        workspaceId: req.workspaceId!,
        url: body.url,
        events: body.events,
        secret,
        active: body.active ?? true,
      },
    });
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.webhook.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = createSchema.partial().parse(req.body);
    return prisma.webhook.update({ where: { id }, data: body });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.webhook.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.webhook.delete({ where: { id } });
    return { ok: true };
  });
};
