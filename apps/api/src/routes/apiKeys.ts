import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const createSchema = z.object({
  name: z.string().min(1),
  permissions: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    return prisma.apiKey.findMany({
      where: { workspaceId: req.workspaceId! },
      select: { id: true, name: true, prefix: true, permissions: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/', async (req) => {
    const body = createSchema.parse(req.body);
    const raw = `pk_${crypto.randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 8);
    const keyHash = await bcrypt.hash(raw, 10);
    const k = await prisma.apiKey.create({
      data: {
        workspaceId: req.workspaceId!,
        name: body.name,
        permissions: body.permissions ?? [],
        keyHash,
        prefix,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
    return { id: k.id, name: k.name, prefix, plainKey: raw, createdAt: k.createdAt };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.apiKey.findFirst({ where: { id, workspaceId: req.workspaceId! } });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    await prisma.apiKey.delete({ where: { id } });
    return { ok: true };
  });
};
