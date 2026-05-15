import { prisma } from './prisma';

export async function logActivity(opts: {
  workspaceId: string;
  userId?: string;
  type: string;
  description: string;
  metadata?: unknown;
  ipAddress?: string;
}) {
  await prisma.activity.create({
    data: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      type: opts.type,
      description: opts.description,
      metadata: opts.metadata as any,
      ipAddress: opts.ipAddress,
    },
  });
}
