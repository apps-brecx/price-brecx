/* eslint-disable */
/**
 * Lost Buy Box report (ported from the standalone Missed-Buy-Box app).
 *
 *  - lost_buybox_runs   : one snapshot per workspace — the latest scan result,
 *                         survives reloads (mirrors the legacy `analyses` table).
 *  - lost_buybox_losses : append-only history of every detected loss event
 *                         (powers the email digest + future trend reporting).
 *  - ignored_asins      : per-workspace ignore list. Ignored ASINs are dropped
 *                         before the Buy Box check and never trigger a notify.
 *                         Snapshot columns keep the report context (SKU /
 *                         product / prices / winner) at the moment of ignoring.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table lost_buybox_runs (
      workspace_id    uuid primary key references workspaces(id) on delete cascade,
      marketplace_id  text,
      seller_id       text,
      inventory_count integer not null default 0,
      summary         jsonb not null default '{}'::jsonb,
      rows            jsonb not null default '[]'::jsonb,
      errored_asins   jsonb not null default '[]'::jsonb,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    );

    create table lost_buybox_losses (
      id               uuid primary key default gen_random_uuid(),
      workspace_id     uuid not null references workspaces(id) on delete cascade,
      asin             text not null,
      reason           text not null,
      marketplace_id   text,
      buybox_price     numeric(12,2),
      my_price         numeric(12,2),
      buybox_seller_id text,
      detected_at      timestamptz not null default now()
    );
    create index lost_buybox_losses_ws_asin_idx on lost_buybox_losses(workspace_id, asin);
    create index lost_buybox_losses_detected_idx on lost_buybox_losses(detected_at desc);

    create table ignored_asins (
      workspace_id     uuid not null references workspaces(id) on delete cascade,
      asin             text not null,
      note             text,
      seller_sku       text,
      product_name     text,
      my_price         numeric(12,2),
      buybox_price     numeric(12,2),
      buybox_seller_id text,
      marketplace_id   text,
      ignored_at       timestamptz not null default now(),
      primary key (workspace_id, asin)
    );
    create index ignored_asins_workspace_idx on ignored_asins(workspace_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists ignored_asins;
    drop table if exists lost_buybox_losses;
    drop table if exists lost_buybox_runs;
  `);
};
