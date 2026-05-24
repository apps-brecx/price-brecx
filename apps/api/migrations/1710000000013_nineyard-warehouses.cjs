/* eslint-disable */
/**
 * Per-master-item warehouse stock — the Pricing page card's "FBM: X / Shelves: Y"
 * line in the reference app. NineYard exposes this via
 * GET /api/Items/GetItemLocations?ItemId=X (one item per call); the sync
 * worker walks every item and stores the result here as a flat map keyed by
 * warehouse name.
 *
 * Example shape:
 *   { "Brecx FBM": 45, "Brecx-Shelves": 0 }
 *
 * Stored as jsonb so warehouse names can vary across companies without a
 * schema change.
 */
exports.up = (pgm) => {
  pgm.sql(`
    alter table nineyard_items
      add column warehouse_stock jsonb not null default '{}'::jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    alter table nineyard_items drop column warehouse_stock;
  `);
};
