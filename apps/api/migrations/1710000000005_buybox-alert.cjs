/* eslint-disable */
/**
 * Buy Box Alert settings — one row per workspace. Drives the scheduled email
 * digest of the latest Lost Buy Box scan (sent at `send_time` in `timezone`).
 *
 * `last_sent_on` is the local calendar date (text "YYYY-MM-DD") the digest was
 * last handled, so the every-15-min cron sends at most once per day.
 */
exports.up = (pgm) => {
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
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists buybox_alert_settings;`);
};
