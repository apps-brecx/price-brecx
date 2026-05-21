import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

/** Inventory view is derived from SKU stock levels. */
export default async function inventoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/inventory", async (req) => {
    // We sum the decomposition columns rather than `stock` because some legacy
    // rows still have stock=0 (FBA sync hasn't recomputed them yet). Whichever
    // is larger is the real-world channel inventory.
    const items = await sql`
      select id as "skuId", sku, asin, title, image_url as "imageUrl",
             channel, status,
             fulfillment_channel as "fulfillmentChannel",
             fn_sku as "fnSku",
             merchant_quantity as "merchantQty",
             fba_fulfillable_quantity as "fbaFulfillable",
             fba_pending_transship_quantity as "fbaPending",
             greatest(
               stock,
               coalesce(merchant_quantity,0)
                 + coalesce(fba_fulfillable_quantity,0)
                 + coalesce(fba_pending_transship_quantity,0)
             )::int as stock,
             sales_30d as "sales30d",
             price::float8 as price,
             updated_at as "updatedAt"
      from skus
      where workspace_id = ${req.user!.workspaceId}
      order by greatest(
        stock,
        coalesce(merchant_quantity,0)
          + coalesce(fba_fulfillable_quantity,0)
          + coalesce(fba_pending_transship_quantity,0)
      ) asc, sku asc
    `;
    const [agg] = await sql<
      {
        totalUnits: number;
        outOfStock: number;
        lowStock: number;
        skuCount: number;
      }[]
    >`
      with s as (
        select greatest(
                 stock,
                 coalesce(merchant_quantity,0)
                   + coalesce(fba_fulfillable_quantity,0)
                   + coalesce(fba_pending_transship_quantity,0)
               ) as stock
          from skus
         where workspace_id = ${req.user!.workspaceId}
      )
      select
        coalesce(sum(stock),0)::int as "totalUnits",
        count(*) filter (where stock <= 0)::int as "outOfStock",
        count(*) filter (where stock > 0 and stock < 10)::int as "lowStock",
        count(*)::int as "skuCount"
      from s
    `;
    // Most recent FBA stage activity — used to show "last synced" hint and to
    // tell the user when the next auto-sync will populate stock.
    const [lastFbaSync] = await sql<
      { at: string; ok: boolean; affected: number | null }[]
    >`
      select created_at as "at",
             (meta->>'error') is null as "ok",
             nullif(meta->>'affected','')::int as "affected"
        from activity_log
       where workspace_id = ${req.user!.workspaceId}
         and entity_type = 'sku'
         and meta->>'stage' = 'fba'
       order by created_at desc
       limit 1
    `;
    return {
      items,
      agg,
      lastFbaSync: lastFbaSync
        ? {
            at: lastFbaSync.at,
            ok: lastFbaSync.ok,
            affected: lastFbaSync.affected,
          }
        : null,
    };
  });
}
