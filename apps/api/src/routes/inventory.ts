import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";

/**
 * Inventory view — derived from SKU stock levels.
 *
 * Server-side pagination + filtering. The Inventory page previously fetched
 * every SKU in one shot (15k+ rows ≈ 4 MB JSON) and rendered them all into
 * the DOM, which was hanging the browser on load. We now serve the visible
 * page only; the four KPI cards still reflect the full dataset because they
 * come from a separate aggregate query.
 */
export default async function inventoryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  const listQuery = z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    search: z.string().trim().optional(),
    tab: z.enum(["all", "in", "low", "out"]).default("all"),
    channel: z.string().optional(),
  });

  app.get("/inventory", async (req) => {
    const wsId = req.user!.workspaceId;
    const q = listQuery.parse(req.query);
    const offset = (q.page - 1) * q.pageSize;
    const search = q.search ? `%${q.search}%` : null;

    // `effectiveStock` is the larger of stored `stock` and the decomposition
    // sum — legacy rows sometimes have stock=0 because the FBA stage hadn't
    // recomputed yet. We reuse the expression for WHERE filters and ORDER BY.
    const effectiveStockSql = sql`greatest(
      stock,
      coalesce(merchant_quantity,0)
        + coalesce(fba_fulfillable_quantity,0)
        + coalesce(fba_pending_transship_quantity,0)
    )`;

    const where = sql`
      where workspace_id = ${wsId}
      ${search ? sql`and (sku ilike ${search} or title ilike ${search} or asin ilike ${search})` : sql``}
      ${q.channel && q.channel !== "all" ? sql`and channel = ${q.channel}` : sql``}
      ${q.tab === "in" ? sql`and ${effectiveStockSql} >= 10` : sql``}
      ${q.tab === "low" ? sql`and ${effectiveStockSql} > 0 and ${effectiveStockSql} < 10` : sql``}
      ${q.tab === "out" ? sql`and ${effectiveStockSql} <= 0` : sql``}
    `;

    // Filtered total — drives the pagination footer + "N of M" label.
    const [{ count: filteredCount }] = await sql<{ count: number }[]>`
      select count(*)::int as count from skus ${where}
    `;

    const items = await sql`
      select id as "skuId", sku, asin, title, image_url as "imageUrl",
             channel, status,
             fulfillment_channel as "fulfillmentChannel",
             fn_sku as "fnSku",
             merchant_quantity as "merchantQty",
             fba_fulfillable_quantity as "fbaFulfillable",
             fba_pending_transship_quantity as "fbaPending",
             ${effectiveStockSql}::int as stock,
             sales_30d as "sales30d",
             price::float8 as price,
             updated_at as "updatedAt"
        from skus
        ${where}
       order by ${effectiveStockSql} asc, sku asc
       limit ${q.pageSize} offset ${offset}
    `;

    // Aggregates are always whole-workspace, NOT filter-aware — the four KPI
    // cards at the top show overall inventory health regardless of which tab
    // / search the user is on.
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
         where workspace_id = ${wsId}
      )
      select
        coalesce(sum(stock),0)::int as "totalUnits",
        count(*) filter (where stock <= 0)::int as "outOfStock",
        count(*) filter (where stock > 0 and stock < 10)::int as "lowStock",
        count(*)::int as "skuCount"
      from s
    `;

    // Distinct channels + per-channel counts (whole workspace, for the
    // channel-filter dropdown chip counts).
    const channelRows = await sql<{ channel: string; count: number }[]>`
      select channel, count(*)::int as count
        from skus
       where workspace_id = ${wsId}
       group by channel
    `;
    const channelCounts: Record<string, number> = { all: agg?.skuCount ?? 0 };
    for (const r of channelRows) channelCounts[r.channel] = r.count;

    // Tab counts also whole-workspace (consistency with KPI cards).
    const [tabCountsRow] = await sql<
      { inCount: number; lowCount: number; outCount: number }[]
    >`
      with s as (
        select greatest(
                 stock,
                 coalesce(merchant_quantity,0)
                   + coalesce(fba_fulfillable_quantity,0)
                   + coalesce(fba_pending_transship_quantity,0)
               ) as stock
          from skus
         where workspace_id = ${wsId}
      )
      select count(*) filter (where stock >= 10)::int as "inCount",
             count(*) filter (where stock > 0 and stock < 10)::int as "lowCount",
             count(*) filter (where stock <= 0)::int as "outCount"
        from s
    `;

    const [lastFbaSync] = await sql<
      { at: string; ok: boolean; affected: number | null }[]
    >`
      select created_at as "at",
             (meta->>'error') is null as "ok",
             nullif(meta->>'affected','')::int as "affected"
        from activity_log
       where workspace_id = ${wsId}
         and entity_type = 'sku'
         and meta->>'stage' = 'fba'
       order by created_at desc
       limit 1
    `;

    return {
      items,
      total: filteredCount,
      page: q.page,
      pageSize: q.pageSize,
      agg,
      channelCounts,
      tabCounts: {
        all: agg?.skuCount ?? 0,
        in: tabCountsRow?.inCount ?? 0,
        low: tabCountsRow?.lowCount ?? 0,
        out: tabCountsRow?.outCount ?? 0,
      },
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
