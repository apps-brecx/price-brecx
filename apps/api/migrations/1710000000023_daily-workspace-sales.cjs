/* eslint-disable */
/**
 * Daily workspace-wide sales totals, populated by /sales/v1/orderMetrics
 * (NOT the All-Orders Report). Why a separate table from daily_sales:
 *  - daily_sales is per-SKU and bounded by the All-Orders Report's ~60-day
 *    historical window. It accumulates over time as daily syncs run.
 *  - orderMetrics returns workspace-wide aggregates and supports up to
 *    ~2 years of history in a single backfill, but provides NO per-SKU
 *    breakdown. Storing it separately keeps the per-SKU table queries
 *    simple and gives charts a long historical runway.
 *
 * The Sale Report's daily/monthly chart endpoints prefer this table when
 * no per-SKU/ASIN identifier filter is present; per-SKU queries continue
 * to use daily_sales.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table daily_workspace_sales (
      workspace_id uuid not null references workspaces(id) on delete cascade,
      date         date not null,
      units        integer not null default 0,
      revenue      numeric(14,2) not null default 0,
      updated_at   timestamptz not null default now(),
      primary key (workspace_id, date)
    );
  `);
  pgm.sql(`create index daily_workspace_sales_ws_date_idx on daily_workspace_sales(workspace_id, date);`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists daily_workspace_sales;`);
};
