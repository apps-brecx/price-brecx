/* eslint-disable */
/**
 * `asin` on products — lets the SKU→product auto-grouping use ASIN as the
 * dedup key, so multiple SKUs (one per channel) of the same listing collapse
 * into a single product instead of one product per SKU.
 *
 * Unique index is partial (only when asin is non-null) so manually-created
 * products with no ASIN aren't blocked by a uniqueness conflict.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table products add column asin text;
    create unique index products_workspace_asin_uniq
      on products (workspace_id, asin)
      where asin is not null;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop index if exists products_workspace_asin_uniq;
    alter table products drop column asin;
  `);
};
