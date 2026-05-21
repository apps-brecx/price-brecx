/* eslint-disable */
/**
 * `updated_at` on products — drives the "Last edited" KPI on the Products page.
 * Existing rows get backfilled to created_at so the KPI shows a sensible value
 * before any product is touched.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table products
      add column updated_at timestamptz not null default now();
    update products set updated_at = created_at;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`alter table products drop column updated_at;`);
};
