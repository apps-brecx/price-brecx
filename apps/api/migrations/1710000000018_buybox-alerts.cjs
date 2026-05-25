/* eslint-disable */
/**
 * Buy Box alerts — replaces the single per-workspace `buybox_alert_settings`
 * row with a list of independent alerts. Each alert has its own schedule
 * (send_time/timezone), recipient emails, and a filter (loss `reasons` +
 * the `special_only` Syruvia/Bursting preset), so different filters can be
 * routed to different recipients.
 *
 * The existing single config is migrated into the new table as one "All
 * losses" alert per workspace, then the old table is dropped.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table buybox_alerts (
      id           uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name         text not null default 'Buy Box alert',
      enabled      boolean not null default false,
      send_time    text not null default '09:00',
      timezone     text not null default 'America/New_York',
      emails       jsonb not null default '[]'::jsonb,
      reasons      jsonb not null default '[]'::jsonb,
      special_only boolean not null default false,
      last_sent_on text,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    );
  `);
  pgm.sql(`create index buybox_alerts_workspace_idx on buybox_alerts(workspace_id);`);

  // Migrate the existing single config into the new list (one "All losses"
  // alert per workspace) so nothing already set up is lost.
  pgm.sql(`
    insert into buybox_alerts
      (workspace_id, name, enabled, send_time, timezone, emails,
       reasons, special_only, last_sent_on, created_at, updated_at)
    select workspace_id, 'All losses', enabled, send_time, timezone, emails,
           '[]'::jsonb, false, last_sent_on, created_at, updated_at
      from buybox_alert_settings;
  `);

  pgm.sql(`drop table if exists buybox_alert_settings;`);
};

exports.down = (pgm) => {
  pgm.sql(`
    create table buybox_alert_settings (
      workspace_id uuid primary key references workspaces(id) on delete cascade,
      enabled      boolean not null default false,
      send_time    text not null default '09:00',
      timezone     text not null default 'America/New_York',
      emails       jsonb not null default '[]'::jsonb,
      last_sent_on text,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    );
  `);

  // Collapse back to one row per workspace — keep the earliest-created alert.
  pgm.sql(`
    insert into buybox_alert_settings
      (workspace_id, enabled, send_time, timezone, emails, last_sent_on,
       created_at, updated_at)
    select distinct on (workspace_id)
           workspace_id, enabled, send_time, timezone, emails, last_sent_on,
           created_at, updated_at
      from buybox_alerts
     order by workspace_id, created_at asc;
  `);

  pgm.sql(`drop table if exists buybox_alerts;`);
};
