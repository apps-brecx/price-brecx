/* eslint-disable */
/**
 * Sales alerts — replaces the single-row `sales_alert_settings` table with
 * a list of independent alerts per workspace. Each alert has its own
 * thresholds, schedule, recipients, and an optional tag/channel filter so
 * different filters can be routed to different recipients (mirrors the
 * 0018_buybox-alerts migration).
 *
 * The existing single config is migrated into the new table as one
 * "All SKUs" alert per workspace, then the old table is dropped.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table sales_alerts (
      id                   uuid primary key default gen_random_uuid(),
      workspace_id         uuid not null references workspaces(id) on delete cascade,
      name                 text not null default 'Sales alert',
      enabled              boolean not null default false,
      send_time            text not null default '09:00',
      timezone             text not null default 'America/New_York',
      emails               jsonb not null default '[]'::jsonb,
      threshold_drop_pct   integer not null default 30,
      threshold_zero_days  integer not null default 14,
      threshold_low_days   integer not null default 14,
      tag_labels           jsonb not null default '[]'::jsonb,
      channels             jsonb not null default '[]'::jsonb,
      last_sent_on         text,
      created_at           timestamptz not null default now(),
      updated_at           timestamptz not null default now()
    );
  `);
  pgm.sql(`create index sales_alerts_workspace_idx on sales_alerts(workspace_id);`);

  // Migrate the existing single config into the new list (one "All SKUs"
  // alert per workspace) so nothing already set up is lost.
  pgm.sql(`
    insert into sales_alerts
      (workspace_id, name, enabled, send_time, timezone, emails,
       threshold_drop_pct, threshold_zero_days, threshold_low_days,
       tag_labels, channels, last_sent_on, created_at, updated_at)
    select workspace_id, 'All SKUs', enabled, send_time, timezone, emails,
           threshold_drop_pct, threshold_zero_days, threshold_low_days,
           '[]'::jsonb, '[]'::jsonb, last_sent_on, created_at, updated_at
      from sales_alert_settings;
  `);

  pgm.sql(`drop table if exists sales_alert_settings;`);
};

exports.down = (pgm) => {
  pgm.sql(`
    create table sales_alert_settings (
      workspace_id           uuid primary key references workspaces(id) on delete cascade,
      enabled                boolean not null default false,
      send_time              text not null default '09:00',
      timezone               text not null default 'America/New_York',
      emails                 jsonb not null default '[]'::jsonb,
      threshold_drop_pct     integer not null default 30,
      threshold_zero_days    integer not null default 14,
      threshold_low_days     integer not null default 14,
      last_sent_on           text,
      created_at             timestamptz not null default now(),
      updated_at             timestamptz not null default now()
    );
  `);

  pgm.sql(`
    insert into sales_alert_settings
      (workspace_id, enabled, send_time, timezone, emails,
       threshold_drop_pct, threshold_zero_days, threshold_low_days,
       last_sent_on, created_at, updated_at)
    select distinct on (workspace_id)
           workspace_id, enabled, send_time, timezone, emails,
           threshold_drop_pct, threshold_zero_days, threshold_low_days,
           last_sent_on, created_at, updated_at
      from sales_alerts
     order by workspace_id, created_at asc;
  `);

  pgm.sql(`drop table if exists sales_alerts;`);
};
