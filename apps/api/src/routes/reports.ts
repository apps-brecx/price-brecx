import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

/**
 * Sales report aggregated from SKU sales figures. Real per-day metrics would
 * come from the Amazon provider; this exposes the stored figures so the
 * Reports page renders real workspace data instead of HTML mock rows.
 */
export default async function reportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/reports/sales", async (req) => {
    const rows = await sql`
      select id as "skuId", sku, title,
             sales_30d as units,
             (sales_30d * price)::float8 as revenue,
             0 as "prevUnits", 0::float8 as "prevRevenue"
      from skus
      where workspace_id = ${req.user!.workspaceId}
      order by sales_30d desc
      limit 200
    `;
    const totals = rows.reduce(
      (acc, r) => {
        acc.units += Number(r.units);
        acc.revenue += Number(r.revenue);
        return acc;
      },
      { units: 0, revenue: 0 },
    );
    return { items: rows, totals };
  });
}
