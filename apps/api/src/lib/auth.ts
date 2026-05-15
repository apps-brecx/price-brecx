import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from './prisma';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
    req.userId = (req.user as any).userId;
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireWorkspace(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;

  const headerWs = (req.headers['x-workspace-id'] as string | undefined) ?? undefined;
  const userId = req.userId!;

  if (headerWs) {
    const membership = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: headerWs } },
    });
    if (!membership) {
      return reply.code(403).send({ error: 'Forbidden — no access to workspace' });
    }
    req.workspaceId = headerWs;
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
  });
  if (!membership) {
    return reply.code(403).send({ error: 'No workspace membership' });
  }
  req.workspaceId = membership.workspaceId;
}
