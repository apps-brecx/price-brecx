/* eslint-disable */
/**
 * Resolved geolocation (country + city) per session, looked up at sign-in
 * via ip-api.com. Stored alongside the rest of the session metadata so the
 * Security panel can label each device with its origin without re-hitting
 * the geo API on every page load.
 *
 * Nullable — when the lookup fails (local IPs, network errors, missing
 * provider data) the columns stay null and the UI falls back to "—".
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table sessions
      add column country text,
      add column city text;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    alter table sessions
      drop column if exists city,
      drop column if exists country;
  `);
};
