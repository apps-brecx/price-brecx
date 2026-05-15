import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'workspace';
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/sign-up', async (req, reply) => {
    const body = signUpSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(body.password, 10);
    const baseSlug = slugify(body.workspaceName ?? body.email.split('@')[0]);
    let slug = baseSlug;
    let n = 1;
    while (await prisma.workspace.findUnique({ where: { slug } })) {
      n += 1;
      slug = `${baseSlug}-${n}`;
    }

    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, name: body.name },
    });
    const workspace = await prisma.workspace.create({
      data: { name: body.workspaceName ?? `${body.name ?? 'My'} Workspace`, slug, ownerId: user.id },
    });
    await prisma.membership.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: 'OWNER',
        permissions: ['admin', 'write', 'billing'],
      },
    });

    const token = app.jwt.sign({ userId: user.id });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
    });
  });

  app.post('/sign-in', async (req, reply) => {
    const body = signInSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'Invalid credentials' });

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });

    const token = app.jwt.sign({ userId: user.id });
    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      workspace: membership
        ? { id: membership.workspace.id, slug: membership.workspace.slug, name: membership.workspace.name }
        : null,
    });
  });
};
