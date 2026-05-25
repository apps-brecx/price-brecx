/* eslint-disable */
/**
 * Daily per-SKU sales cache. Populated by the existing All-Orders Report sync
 * (apps/api/src/amazon/sync.ts → syncSales). Each row is one (workspace, SKU,
 * day) tuple with that day's units + revenue.
 *
 * Why a cache: SP-API's All-Orders Report only carries ~60 days, but we want
 * to show line / pie charts spanning many months. By upserting on every sync
 * and never deleting, history accumulates over time.
 *
 * `asin` is denormalised here so charts that group by ASIN don't need to join.
 * `date` is the local shipped date in the workspace's marketplace timezone.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table daily_sales (
      workspace_id uuid not null references workspaces(id) on delete cascade,
      sku          text not null,
      asin         text,
      date         date not null,
      units        integer not null default 0,
      revenue      numeric(14,2) not null default 0,
      updated_at   timestamptz not null default now(),
      primary key (workspace_id, sku, date)
    );
  `);
  pgm.sql(`create index daily_sales_ws_date_idx on daily_sales(workspace_id, date);`);
  pgm.sql(`create index daily_sales_ws_asin_date_idx on daily_sales(workspace_id, asin, date) where asin is not null;`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists daily_sales;`);
};
