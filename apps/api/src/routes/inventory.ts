import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

/** Inventory view is derived from SKU stock levels. */
export default async function inventoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/inventory", async (req) => {
    const items = await sql`
      select id as "skuId", sku, asin, title, image_url as "imageUrl",
             channel, stock, sales_30d as "sales30d",
             price::float8 as price, status
      from skus
      where workspace_id = ${req.user!.workspaceId}
      order by stock asc
    `;
    const [agg] = await sql<
      { totalUnits: number; outOfStock: number; lowStock: number }[]
    >`
      select
        coalesce(sum(stock),0)::int as "totalUnits",
        count(*) filter (where stock = 0)::int as "outOfStock",
        count(*) filter (where stock > 0 and stock < 10)::int as "lowStock"
      from skus where workspace_id = ${req.user!.workspaceId}
    `;
    return { items, agg };
  });
}
