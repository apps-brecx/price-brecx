import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['OWNER', 'ADMIN', 'USER', 'VIEWER']),
  initialPassword: z.string().min(8).optional(),
});

const roleSchema = z.object({ role: z.enum(['OWNER', 'ADMIN', 'USER', 'VIEWER']) });

async function requireAdmin(req: any, reply: any) {
  const m = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: req.userId, workspaceId: req.workspaceId } },
  });
  if (!m || !['OWNER', 'ADMIN'].includes(m.role)) {
    return reply.code(403).send({ error: 'Admins only' });
  }
}

export const teamRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const members = await prisma.membership.findMany({
      where: { workspaceId: req.workspaceId! },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      permissions: m.permissions,
      joinedAt: m.joinedAt,
    }));
  });

  app.post('/invite', async (req, reply) => {
    await requireAdmin(req, reply);
    if (reply.sent) return;
    const body = inviteSchema.parse(req.body);

    let user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      const password = body.initialPassword ?? Math.random().toString(36).slice(2, 14);
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: { email: body.email, name: body.name, passwordHash },
      });
      const exists = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: req.workspaceId! } },
      });
      if (exists) return reply.code(409).send({ error: 'Already a member' });
      await prisma.membership.create({
        data: { userId: user.id, workspaceId: req.workspaceId!, role: body.role, invitedBy: req.userId },
      });
      return { ok: true, userId: user.id, generatedPassword: body.initialPassword ? undefined : password };
    }

    const exists = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: req.workspaceId! } },
    });
    if (exists) return reply.code(409).send({ error: 'Already a member' });
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: req.workspaceId!, role: body.role, invitedBy: req.userId },
    });
    return { ok: true, userId: user.id };
  });

  app.patch('/:userId/role', async (req, reply) => {
    await requireAdmin(req, reply);
    if (reply.sent) return;
    const { userId } = req.params as { userId: string };
    const body = roleSchema.parse(req.body);
    const m = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: req.workspaceId! } },
    });
    if (!m) return reply.code(404).send({ error: 'Not found' });
    return prisma.membership.update({
      where: { userId_workspaceId: { userId, workspaceId: req.workspaceId! } },
      data: { role: body.role },
    });
  });

  app.delete('/:userId', async (req, reply) => {
    await requireAdmin(req, reply);
    if (reply.sent) return;
    const { userId } = req.params as { userId: string };
    const ws = await prisma.workspace.findUnique({ where: { id: req.workspaceId! } });
    if (ws?.ownerId === userId) return reply.code(400).send({ error: 'Cannot remove owner' });
    await prisma.membership.delete({
      where: { userId_workspaceId: { userId, workspaceId: req.workspaceId! } },
    });
    return { ok: true };
  });
};
