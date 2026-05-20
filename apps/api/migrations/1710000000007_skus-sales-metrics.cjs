/* eslint-disable */
/**
 * Per-SKU sales metrics + FBA stock decomposition, ported from the legacy
 * app's SaleStock + Stock collections.
 *
 *  - sales_metrics jsonb      : array [{period:"1d"|"7d"|"15d"|"30d", units, revenue}]
 *  - fn_sku       text        : Amazon-fulfillable barcode (from FBA summaries)
 *
 *  - merchant_quantity        int : listing report's `quantity` (FBM)
 *  - fba_fulfillable_quantity int : FBA inventory `fulfillableQuantity`
 *  - fba_pending_transship_quantity int : FBA `pendingTransshipmentQuantity`
 *
 * `stock` stays as the visible channel-stock total = merchant + fulfillable +
 * pending, kept in sync by both the listings sync and the FBA sync stages.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table skus
      add column sales_metrics jsonb not null default '[]'::jsonb,
      add column fn_sku text,
      add column merchant_quantity integer not null default 0,
      add column fba_fulfillable_quantity integer not null default 0,
      add column fba_pending_transship_quantity integer not null default 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    alter table skus
      drop column sales_metrics,
      drop column fn_sku,
      drop column merchant_quantity,
      drop column fba_fulfillable_quantity,
      drop column fba_pending_transship_quantity;
  `);
};
