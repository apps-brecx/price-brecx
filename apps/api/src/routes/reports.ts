import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  // Aggregate price changes per day in the given range
  app.get('/sales', async (req) => {
    const q = req.query as Record<string, string>;
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await prisma.priceHistory.findMany({
      where: {
        listing: { sku: { workspaceId: req.workspaceId! } },
        changedAt: { gte: from, lte: to },
      },
      select: { changedAt: true, oldPrice: true, newPrice: true, status: true },
    });

    const bucket = new Map<string, { changes: number; failures: number; deltaSum: number }>();
    for (const r of rows) {
      const key = r.changedAt.toISOString().slice(0, 10);
      const b = bucket.get(key) ?? { changes: 0, failures: 0, deltaSum: 0 };
      b.changes++;
      if (r.status === 'FAILED') b.failures++;
      b.deltaSum += Number(r.newPrice) - Number(r.oldPrice);
      bucket.set(key, b);
    }
    const series = Array.from(bucket.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { from, to, series, total: rows.length };
  });

  app.get('/by-month', async (req) => {
    const rows = await prisma.priceHistory.findMany({
      where: { listing: { sku: { workspaceId: req.workspaceId! } } },
      select: { changedAt: true, status: true },
    });
    const months = new Map<string, { total: number; success: number; failed: number }>();
    for (const r of rows) {
      const k = startOfMonth(r.changedAt).toISOString().slice(0, 7);
      const m = months.get(k) ?? { total: 0, success: 0, failed: 0 };
      m.total++;
      if (r.status === 'SUCCESS') m.success++;
      if (r.status === 'FAILED') m.failed++;
      months.set(k, m);
    }
    return Array.from(months.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));
  });

  app.get('/by-marketplace', async (req) => {
    const grouped = await prisma.marketplaceConnection.findMany({
      where: { workspaceId: req.workspaceId! },
      include: {
        listings: {
          include: { priceHistory: { select: { id: true } } },
        },
      },
    });
    return grouped.map((m) => ({
      id: m.id,
      marketplace: m.marketplace,
      displayName: m.displayName,
      listings: m.listings.length,
      priceChanges: m.listings.reduce((a, l) => a + l.priceHistory.length, 0),
    }));
  });
};
