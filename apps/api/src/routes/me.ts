import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../lib/auth';

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: {
        memberships: { include: { workspace: true }, orderBy: { joinedAt: 'asc' } },
      },
    });
    if (!user) return { user: null, workspaces: [] };
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        timezone: user.timezone,
      },
      workspaces: user.memberships.map((m) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        role: m.role,
        plan: m.workspace.plan,
      })),
    };
  });
};
