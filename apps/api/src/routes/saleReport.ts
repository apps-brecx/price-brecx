import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import {
  getBoss,
  SALES_SYNC_QUEUE,
  SALES_BACKFILL_QUEUE,
  SALES_DEEP_BACKFILL_QUEUE,
} from "../jobs.js";

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
   * Daily series for line charts.
   *  - identifier omitted (workspace-wide): read daily_workspace_sales,
   *    which has the long-history orderMetrics backfill if it's been run.
   *    Falls back to summing daily_sales for any dates the workspace table
   *    is missing (covers the gap between the last backfill and today).
   *  - identifier set (per-SKU/ASIN): read daily_sales directly.
   */
  app.get("/sale-report/daily", async (req) => {
    const q = dailyQuerySchema.parse(req.query);
    const wsId = req.user!.workspaceId;

    if (!q.identifier) {
      // Workspace-wide: prefer daily_workspace_sales; for any dates not in
      // there fall back to a SUM over daily_sales so we don't show a hole.
      const rows = await sql<
        { date: string; units: number; revenue: number }[]
      >`
        with ws as (
          select date, units, revenue
            from daily_workspace_sales
           where workspace_id = ${wsId}
             and date between ${q.start}::date and ${q.end}::date
        ),
        ds as (
          select date, sum(units)::int as units, sum(revenue)::numeric(14,2) as revenue
            from daily_sales
           where workspace_id = ${wsId}
             and date between ${q.start}::date and ${q.end}::date
             and date not in (select date from ws)
           group by date
        )
        select to_char(date, 'YYYY-MM-DD') as date, units, revenue from ws
        union all
        select to_char(date, 'YYYY-MM-DD') as date, units, revenue from ds
        order by date asc
      `;
      return {
        items: rows.map((r) => ({
          date: r.date,
          units: r.units,
          revenue: Number(r.revenue),
        })),
      };
    }

    // Per-SKU / per-ASIN: only daily_sales has the breakdown.
    const rows = await sql<{ date: string; units: number; revenue: number }[]>`
      select to_char(d.date, 'YYYY-MM-DD') as date,
             sum(d.units)::int as units,
             sum(d.revenue)::numeric(14,2) as revenue
        from daily_sales d
       where d.workspace_id = ${wsId}
         and d.date between ${q.start}::date and ${q.end}::date
         and (
           (${q.mode} = 'asin' and d.asin = ${q.identifier})
           or (${q.mode} = 'sku' and d.sku = ${q.identifier})
         )
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
  /**
   * Smart sync — single entry point used by the Report page button and the
   * auto-trigger. Detects the workspace's data state and enqueues the right
   * combination of jobs:
   *
   *  - First-time (no daily_workspace_sales rows): enqueue the deep
   *    18-month backfill + the 90-day per-SKU backfill + the 30-day daily
   *    sync. Sets up the cache from cold.
   *  - Already populated: just the 30-day daily sync (cheap, fast refresh).
   *
   * All runs are async via pg-boss; the page polls daily_sales / charts and
   * refreshes as data lands.
   */
  app.post("/sale-report/sync", async (req) => {
    const wsId = req.user!.workspaceId;
    const actor = req.user!.email;

    const [{ deepCount, dailyCount }] = await sql<
      { deepCount: number; dailyCount: number }[]
    >`
      select
        (select count(*)::int from daily_workspace_sales where workspace_id = ${wsId}) as "deepCount",
        (select count(*)::int from daily_sales where workspace_id = ${wsId}) as "dailyCount"
    `;
    const firstTime = deepCount === 0 || dailyCount === 0;

    const boss = getBoss();
    const payload = { workspaceId: wsId, actor };

    if (firstTime) {
      await boss.send(SALES_DEEP_BACKFILL_QUEUE, payload);
      await boss.send(SALES_BACKFILL_QUEUE, payload);
    }
    await boss.send(SALES_SYNC_QUEUE, payload);

    return { ok: true, firstTime };
  });

  /**
   * One-shot 90-day chunked backfill. Splits into 3 sequential 30-day
   * SP-API report requests so we get usable historical comparisons before
   * the daily cron has had time to accumulate them. Slow (10-15 min) — runs
   * async via pg-boss; activity_log carries progress.
   */
  app.post("/sale-report/backfill", async (req) => {
    await getBoss().send(SALES_BACKFILL_QUEUE, {
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
    });
    return { ok: true };
  });

  /**
   * Deep historical backfill — workspace-wide via /sales/v1/orderMetrics.
   * Populates daily_workspace_sales with ~18 months of daily totals so the
   * Sale Report charts can match the legacy app's long history. No per-SKU
   * breakdown (that's still bounded by daily_sales / the All-Orders Report).
   * Runs async via pg-boss; activity_log records the final count.
   */
  app.post("/sale-report/deep-backfill", async (req) => {
    await getBoss().send(SALES_DEEP_BACKFILL_QUEUE, {
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
    });
    return { ok: true };
  });

  app.get("/sale-report/monthly", async (req) => {
    const q = monthlyQuerySchema.parse(req.query);
    const wsId = req.user!.workspaceId;
    const months = q.months
      .split(",")
      .map((m) => m.trim())
      .filter((m) => /^\d{4}-\d{2}$/.test(m));
    if (months.length === 0) return { items: [] };

    let rows: { ym: string; units: number; revenue: number }[];
    if (!q.identifier) {
      // Workspace-wide — same union pattern as /daily.
      rows = await sql<{ ym: string; units: number; revenue: number }[]>`
        with ws as (
          select to_char(date, 'YYYY-MM') as ym, units, revenue
            from daily_workspace_sales
           where workspace_id = ${wsId}
             and to_char(date, 'YYYY-MM') = any(${months})
        ),
        ds as (
          select to_char(date, 'YYYY-MM') as ym,
                 sum(units)::int as units,
                 sum(revenue)::numeric(14,2) as revenue
            from daily_sales
           where workspace_id = ${wsId}
             and to_char(date, 'YYYY-MM') = any(${months})
             and to_char(date, 'YYYY-MM') not in (select ym from ws)
           group by ym
        )
        select ym, sum(units)::int as units, sum(revenue)::numeric(14,2) as revenue
          from (select * from ws union all select * from ds) u
         group by ym
      `;
    } else {
      rows = await sql<{ ym: string; units: number; revenue: number }[]>`
        select to_char(d.date, 'YYYY-MM') as ym,
               sum(d.units)::int as units,
               sum(d.revenue)::numeric(14,2) as revenue
          from daily_sales d
         where d.workspace_id = ${wsId}
           and to_char(d.date, 'YYYY-MM') = any(${months})
           and (
             (${q.mode} = 'asin' and d.asin = ${q.identifier})
             or (${q.mode} = 'sku' and d.sku = ${q.identifier})
           )
         group by ym
      `;
    }
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
