import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const workspaceId = req.workspaceId!;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [skuCount, listingCount, changes, activeSchedules, openAlerts, marketplaces, upcoming, recentAlerts, recentActivity] = await Promise.all([
      prisma.sKU.count({ where: { workspaceId } }),
      prisma.listing.count({ where: { sku: { workspaceId } } }),
      prisma.priceHistory.count({
        where: { listing: { sku: { workspaceId } }, changedAt: { gte: since } },
      }),
      prisma.priceSchedule.count({ where: { workspaceId, status: { in: ['UPCOMING', 'RUNNING'] } } }),
      prisma.alert.count({ where: { workspaceId, status: 'OPEN' } }),
      prisma.marketplaceConnection.findMany({
        where: { workspaceId },
        include: { _count: { select: { listings: true } } },
      }),
      prisma.priceSchedule.findMany({
        where: { workspaceId, status: 'UPCOMING', startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 5,
        include: { sku: { include: { product: true } } },
      }),
      prisma.alert.findMany({
        where: { workspaceId, status: 'OPEN' },
        orderBy: { triggeredAt: 'desc' },
        take: 5,
      }),
      prisma.activity.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { user: true },
      }),
    ]);

    return {
      kpis: {
        skuCount,
        listingCount,
        priceChanges30d: changes,
        activeSchedules,
        openAlerts,
      },
      marketplaces: marketplaces.map((m) => ({
        id: m.id,
        marketplace: m.marketplace,
        status: m.status,
        displayName: m.displayName,
        skuCount: m._count.listings,
        lastSyncAt: m.lastSyncAt,
      })),
      upcomingSchedules: upcoming.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        type: s.type,
        newPrice: s.newPrice,
        skuCode: s.sku.sku,
        productName: s.sku.product.name,
      })),
      recentAlerts,
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        type: a.type,
        description: a.description,
        createdAt: a.createdAt,
        userName: a.user?.name ?? a.user?.email,
      })),
    };
  });
};
