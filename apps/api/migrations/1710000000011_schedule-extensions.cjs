/* eslint-disable */
/**
 * Price-schedule feature parity with the legacy app.
 *
 *  - until_changed bool        : true = no auto-revert; price holds until manually changed
 *  - time_slots already exists : extended via the shared TimeSlot schema (newPrice + revertPrice)
 *  - boss_cron_keys jsonb      : list of pg-boss cron schedule names this schedule owns; used
 *                                on update/delete to unschedule recurring jobs without orphans
 *
 * No data is lost — defaults are picked so existing rows keep behaving as before.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table price_schedules
      add column until_changed boolean not null default false,
      add column boss_cron_keys jsonb not null default '[]'::jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    alter table price_schedules
      drop column until_changed,
      drop column boss_cron_keys;
  `);
};
