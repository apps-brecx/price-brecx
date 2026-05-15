import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const q = req.query as Record<string, string>;
    const where: any = { workspaceId: req.workspaceId! };
    if (q.type) where.type = q.type;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    const take = Math.min(Number(q.pageSize ?? 50), 200);
    const skip = (Math.max(Number(q.page ?? 1), 1) - 1) * take;
    const [total, items] = await Promise.all([
      prisma.activity.count({ where }),
      prisma.activity.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return { total, items };
  });

  app.get('/export', async (req, reply) => {
    const rows = await prisma.activity.findMany({
      where: { workspaceId: req.workspaceId! },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });
    const csv = [
      'timestamp,user,type,description',
      ...rows.map(
        (r) =>
          `${r.createdAt.toISOString()},${r.user?.email ?? ''},${r.type},"${(r.description ?? '').replace(/"/g, '""')}"`,
      ),
    ].join('\n');
    reply.header('content-type', 'text/csv');
    reply.header('content-disposition', 'attachment; filename="activity.csv"');
    return csv;
  });
};
