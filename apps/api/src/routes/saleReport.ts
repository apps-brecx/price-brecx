import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";

/**
 * Sale Report — backs the /sale-report page. Powered by the `daily_sales`
 * cache populated by the sales sync (see apps/api/src/amazon/sync.ts).
 *
 * Three endpoints:
 *   GET /sale-report          → table rows (current + previous totals)
 *   GET /sale-report/daily    → daily series for line charts
 *   GET /sale-report/monthly  → per-month totals for the pie chart
 *
 * All three accept either SKU mode (group by skus.sku) or ASIN mode (group
 * by skus.asin, summing all SKUs that share an ASIN) and apply the same
 * search filter for parity with the legacy implementation.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

const tableQuerySchema = z.object({
  currentStart: DATE,
  currentEnd: DATE,
  previousStart: DATE,
  previousEnd: DATE,
  mode: z.enum(["sku", "asin"]).default("asin"),
  search: z.string().max(120).optional(),
  favoritesOnly: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

const dailyQuerySchema = z.object({
  start: DATE,
  end: DATE,
  /** Optional single identifier — when present, scope the series to one
   *  SKU/ASIN; otherwise sum across the whole workspace. */
  identifier: z.string().min(1).max(80).optional(),
  mode: z.enum(["sku", "asin"]).default("asin"),
});

const monthlyQuerySchema = z.object({
  /** Comma-separated YYYY-MM list, e.g. "2026-01,2026-02,2026-03". */
  months: z.string().min(1).max(400),
  identifier: z.string().min(1).max(80).optional(),
  mode: z.enum(["sku", "asin"]).default("asin"),
});

export default async function saleReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  /**
   * Table rows — every SKU/ASIN with units in either window. Joins skus to
   * pull title/image/favorite. Returns sorted by current units desc.
   */
  app.get("/sale-report", async (req) => {
    const q = tableQuerySchema.parse(req.query);
    const wsId = req.user!.workspaceId;
    const favoritesOnly = q.favoritesOnly === "true";

    // Group key — "sku" or "asin". For ASIN mode we COALESCE to sku when an
    // ASIN is missing so the row isn't lost entirely.
    const groupExpr = q.mode === "asin" ? sql`coalesce(s.asin, s.sku)` : sql`s.sku`;
    const searchLike = q.search ? `%${q.search.trim().toLowerCase()}%` : null;

    const rows = await sql<
      {
        key: string;
        skuId: string;
        title: string | null;
        imageUrl: string | null;
        sku: string;
        asin: string | null;
        favorite: boolean;
        currentUnits: number;
        currentRevenue: number;
        previousUnits: number;
        previousRevenue: number;
      }[]
    >`
      with current_sums as (
        select ${groupExpr} as key,
               sum(d.units)::int as units,
               sum(d.revenue)::numeric(14,2) as revenue
          from daily_sales d
          join skus s
            on s.workspace_id = d.workspace_id
           and (
             (${q.mode} = 'asin' and (s.asin = d.asin or (d.asin is null and s.sku = d.sku)))
             or (${q.mode} = 'sku' and s.sku = d.sku)
           )
         where d.workspace_id = ${wsId}
           and d.date between ${q.currentStart}::date and ${q.currentEnd}::date
         group by ${groupExpr}
      ),
      previous_sums as (
        select ${groupExpr} as key,
               sum(d.units)::int as units,
               sum(d.revenue)::numeric(14,2) as revenue
          from daily_sales d
          join skus s
            on s.workspace_id = d.workspace_id
           and (
             (${q.mode} = 'asin' and (s.asin = d.asin or (d.asin is null and s.sku = d.sku)))
             or (${q.mode} = 'sku' and s.sku = d.sku)
           )
         where d.workspace_id = ${wsId}
           and d.date between ${q.previousStart}::date and ${q.previousEnd}::date
         group by ${groupExpr}
      ),
      keys as (
        select key from current_sums union select key from previous_sums
      ),
      sku_for_key as (
        select distinct on (${groupExpr})
               ${groupExpr} as key,
               s.id as "skuId",
               s.sku, s.asin, s.title, s.image_url as "imageUrl",
               coalesce(s.favorite, false) as favorite
          from skus s
         where s.workspace_id = ${wsId}
         order by ${groupExpr}, s.created_at asc
      )
      select k.key,
             sk."skuId", sk.sku, sk.asin, sk.title, sk."imageUrl", sk.favorite,
             coalesce(c.units, 0) as "currentUnits",
             coalesce(c.revenue, 0) as "currentRevenue",
             coalesce(p.units, 0) as "previousUnits",
             coalesce(p.revenue, 0) as "previousRevenue"
        from keys k
        left join current_sums c on c.key = k.key
        left join previous_sums p on p.key = k.key
        left join sku_for_key sk on sk.key = k.key
       where (${searchLike}::text is null
           or lower(coalesce(sk.title, '')) like ${searchLike}
           or lower(coalesce(sk.sku, '')) like ${searchLike}
           or lower(coalesce(sk.asin, '')) like ${searchLike})
         and (${favoritesOnly} = false or sk.favorite = true)
       order by "currentUnits" desc, k.key asc
    `;

    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    const slice = rows.slice(start, start + q.pageSize);

    // Workspace-wide totals for the right-rail headline / chart.
    const totals = rows.reduce(
      (acc, r) => {
        acc.currentUnits += r.currentUnits;
        acc.currentRevenue += Number(r.currentRevenue);
        acc.previousUnits += r.previousUnits;
        acc.previousRevenue += Number(r.previousRevenue);
        return acc;
      },
      { currentUnits: 0, currentRevenue: 0, previousUnits: 0, previousRevenue: 0 },
    );

    return {
      items: slice.map((r) => ({
        ...r,
        currentRevenue: Number(r.currentRevenue),
        previousRevenue: Number(r.previousRevenue),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      totals,
    };
  });

  /**
   * Daily series for line charts — workspace-wide when `identifier` is
   * omitted, otherwise scoped to a single SKU/ASIN.
   */
  app.get("/sale-report/daily", async (req) => {
    const q = dailyQuerySchema.parse(req.query);
    const wsId = req.user!.workspaceId;

    const rows = await sql<{ date: string; units: number; revenue: number }[]>`
      select to_char(d.date, 'YYYY-MM-DD') as date,
             sum(d.units)::int as units,
             sum(d.revenue)::numeric(14,2) as revenue
        from daily_sales d
       where d.workspace_id = ${wsId}
         and d.date between ${q.start}::date and ${q.end}::date
         and (${q.identifier ?? null}::text is null
              or (${q.mode} = 'asin' and d.asin = ${q.identifier ?? null})
              or (${q.mode} = 'sku' and d.sku = ${q.identifier ?? null}))
       group by d.date
       order by d.date asc
    `;
    return {
      items: rows.map((r) => ({
        date: r.date,
        units: r.units,
        revenue: Number(r.revenue),
      })),
    };
  });

  /**
   * Monthly totals for the pie chart. Caller supplies the list of months it
   * wants — we return one bucket per requested month even if it's zero, so
   * the chart legend stays stable when the user toggles checkboxes.
   */
  app.get("/sale-report/monthly", async (req) => {
    const q = monthlyQuerySchema.parse(req.query);
    const wsId = req.user!.workspaceId;
    const months = q.months
      .split(",")
      .map((m) => m.trim())
      .filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (months.length === 0) return { items: [] };

    const rows = await sql<{ ym: string; units: number; revenue: number }[]>`
      select to_char(d.date, 'YYYY-MM') as ym,
             sum(d.units)::int as units,
             sum(d.revenue)::numeric(14,2) as revenue
        from daily_sales d
       where d.workspace_id = ${wsId}
         and to_char(d.date, 'YYYY-MM') = any(${months})
         and (${q.identifier ?? null}::text is null
              or (${q.mode} = 'asin' and d.asin = ${q.identifier ?? null})
              or (${q.mode} = 'sku' and d.sku = ${q.identifier ?? null}))
       group by ym
    `;
    const byMonth = new Map(rows.map((r) => [r.ym, r]));
    return {
      items: months.map((m) => {
        const v = byMonth.get(m);
        return {
          month: m,
          units: v ? v.units : 0,
          revenue: v ? Number(v.revenue) : 0,
        };
      }),
    };
  });
}
