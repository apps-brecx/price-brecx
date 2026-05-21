/* eslint-disable */
/**
 * Sales Alert settings — one row per workspace, mirroring buybox_alert_settings.
 * Drives the daily sales-alert email digest. Sent at `send_time` in `timezone`
 * by the SALES_ALERT_DIGEST_QUEUE cron (every 15 min, fires once per day).
 *
 * Thresholds drive which SKUs surface as alerts:
 *  - threshold_drop_pct      : % drop in 7d-vs-prior-7d sales that counts as a "drop"
 *  - threshold_zero_days     : consecutive zero-sale days for "stalled SKU"
 *  - threshold_low_days      : days-of-supply below which we warn "running out"
 */
exports.up = (pgm) => {
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
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists sales_alert_settings;`);
};
