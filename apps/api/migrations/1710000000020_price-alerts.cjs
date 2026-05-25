/* eslint-disable */
/**
 * Price alerts — multiple per workspace, mirroring buybox_alerts.
 *
 * Each row is one scheduled email digest of SKUs whose current price is below
 * a configured percent of their base price. Optional tag/channel scope lets
 * different alerts route different SKU subsets to different recipients.
 *
 * Sent by the PRICE_ALERT_DIGEST_QUEUE cron (every 15 min, fires once per
 * day per alert when local time ≥ send_time).
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table price_alerts (
      id            uuid primary key default gen_random_uuid(),
      workspace_id  uuid not null references workspaces(id) on delete cascade,
      name          text not null default 'Price alert',
      enabled       boolean not null default false,
      send_time     text not null default '09:00',
      timezone      text not null default 'America/New_York',
      emails        jsonb not null default '[]'::jsonb,
      drop_pct      integer not null default 10,
      tag_labels    jsonb not null default '[]'::jsonb,
      channels      jsonb not null default '[]'::jsonb,
      last_sent_on  text,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    );
  `);
  pgm.sql(`create index price_alerts_workspace_idx on price_alerts(workspace_id);`);
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists price_alerts;`);
};
