/* eslint-disable */
/**
 * Active-session metadata for the Security settings page. Stores the
 * client info captured at sign-in so the user can recognise & revoke
 * individual sessions (browser, OS, IP, last activity).
 *
 * The schema stays backward compatible: existing rows just get NULLs for
 * the new columns until they're refreshed on the next sign-in.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table sessions
      add column ip text,
      add column user_agent text,
      add column last_seen_at timestamptz not null default now();

    create index if not exists sessions_user_lastseen_idx
      on sessions (user_id, last_seen_at desc);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop index if exists sessions_user_lastseen_idx;
    alter table sessions
      drop column if exists last_seen_at,
      drop column if exists user_agent,
      drop column if exists ip;
  `);
};
