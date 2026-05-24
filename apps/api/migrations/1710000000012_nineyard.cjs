/* eslint-disable */
/**
 * NineYard inventory integration — replaces the direct Amazon SP-API sync
 * with a single consolidated source. NineYard returns per-(account × channel)
 * marketplace listings, so the legacy `(workspace_id, sku, channel)` unique
 * key no longer holds: FF US and FF CA both list the same `sku` on channel
 * `amazon`. We key on NineYard's globally-unique `accountSkuId` instead.
 *
 * Cleanup of the old direct-Amazon rows (which have account_sku_id IS NULL)
 * is left to a follow-up DELETE so this migration stays idempotent and
 * reversible. Run `delete from skus where account_sku_id is null;` after the
 * first NineYard sync if you want a clean cutover.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1) Per-listing NineYard fields on skus
    alter table skus
      add column account text,
      add column account_sku_id integer,
      add column channel_id text,
      add column nineyard_item_id integer,
      add column min_price numeric(12,2),
      add column max_price numeric(12,2),
      add column default_price numeric(12,2),
      add column map_price numeric(12,2),
      add column reserve integer,
      add column inbound_stock integer,
      add column prep_cost numeric(12,2),
      add column ship_cost numeric(12,2),
      add column markup numeric(12,4),
      add column min_markup numeric(12,4),
      add column is_active boolean not null default true,
      add column is_min_price_manual boolean not null default false,
      add column is_max_price_manual boolean not null default false,
      add column is_map_active boolean not null default false,
      add column price_model integer,
      add column price_model_name text,
      add column rank integer,
      add column category text,
      add column fba_type text,
      add column ny_synced_at timestamptz;

    -- 2) Drop the legacy uniqueness — same (sku, channel) can now exist for
    --    multiple accounts (FF US + FF CA both list "F-SY-5561-1Case" on Amazon).
    alter table skus drop constraint if exists skus_workspace_id_sku_channel_key;

    -- 3) New uniqueness keyed on NineYard's globally-unique accountSkuId.
    --    Partial so existing rows (pre-cutover, account_sku_id null) don't trip it.
    create unique index if not exists skus_workspace_account_sku_key
      on skus (workspace_id, account_sku_id)
      where account_sku_id is not null;

    -- Helpful indexes for the Pricing page grouping queries.
    create index if not exists skus_workspace_account_idx on skus (workspace_id, account);
    create index if not exists skus_workspace_item_idx on skus (workspace_id, nineyard_item_id);

    -- 4) Master inventory items mirrored from /api/Items. One row per
    --    (workspace, NineYard itemId). Image + title + master stock live here;
    --    the Pricing page joins on it to fill product cells when a marketplace
    --    SKU is missing its own image/title.
    create table if not exists nineyard_items (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      nineyard_item_id integer not null,
      item_name text not null,
      vendor_item_name text,
      title text,
      brand text,
      image_url text,
      vendor_name text,
      vendor_id integer,
      qty_on_hand integer not null default 0,
      local_stock integer not null default 0,
      inbound_stock integer not null default 0,
      total_stock integer not null default 0,
      cost numeric(12,4),
      avg_price numeric(12,4),
      case_qty integer,
      lead_days integer,
      purchase_days integer,
      notes text,
      length numeric(8,2),
      height numeric(8,2),
      width numeric(8,2),
      weight numeric(8,2),
      delete_flag boolean not null default false,
      ny_synced_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, nineyard_item_id)
    );
    create index if not exists nineyard_items_workspace_idx on nineyard_items(workspace_id);
    create index if not exists nineyard_items_workspace_name_idx on nineyard_items(workspace_id, item_name);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists nineyard_items;

    drop index if exists skus_workspace_item_idx;
    drop index if exists skus_workspace_account_idx;
    drop index if exists skus_workspace_account_sku_key;

    -- Recreate legacy uniqueness so a rollback leaves the table operable.
    alter table skus add constraint skus_workspace_id_sku_channel_key
      unique (workspace_id, sku, channel);

    alter table skus
      drop column if exists ny_synced_at,
      drop column if exists fba_type,
      drop column if exists category,
      drop column if exists rank,
      drop column if exists price_model_name,
      drop column if exists price_model,
      drop column if exists is_map_active,
      drop column if exists is_max_price_manual,
      drop column if exists is_min_price_manual,
      drop column if exists is_active,
      drop column if exists min_markup,
      drop column if exists markup,
      drop column if exists ship_cost,
      drop column if exists prep_cost,
      drop column if exists inbound_stock,
      drop column if exists reserve,
      drop column if exists map_price,
      drop column if exists default_price,
      drop column if exists max_price,
      drop column if exists min_price,
      drop column if exists nineyard_item_id,
      drop column if exists channel_id,
      drop column if exists account_sku_id,
      drop column if exists account;
  `);
};
