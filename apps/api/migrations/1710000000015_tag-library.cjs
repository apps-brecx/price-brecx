/* eslint-disable */
/**
 * Workspace-wide tag library — three independent catalogs (one per surface
 * the legacy app exposes: SKUs page, Buy Box Alert page, Price/Pricing
 * page). Each row defines a re-usable tag the user can apply to items on
 * the corresponding page.
 *
 *   sku_tags         — for SKUs.tags arrays (existing per-row jsonb).
 *   buybox_tags      — for the Buy Box Alert page.
 *   price_alert_tags — for the Pricing page (NineYard-backed).
 *
 * Tag labels are case-insensitive-unique per workspace via a partial index
 * on lower(label) — same UX as the legacy app where "FBM" and "fbm" are
 * the same tag.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table sku_tags (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      label text not null,
      color text not null default 'gray',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index sku_tags_workspace_label_uk
      on sku_tags (workspace_id, lower(label));
    create index sku_tags_workspace_idx on sku_tags(workspace_id);

    create table buybox_tags (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      label text not null,
      color text not null default 'gray',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index buybox_tags_workspace_label_uk
      on buybox_tags (workspace_id, lower(label));
    create index buybox_tags_workspace_idx on buybox_tags(workspace_id);

    create table price_alert_tags (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      label text not null,
      color text not null default 'gray',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index price_alert_tags_workspace_label_uk
      on price_alert_tags (workspace_id, lower(label));
    create index price_alert_tags_workspace_idx on price_alert_tags(workspace_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists price_alert_tags;
    drop table if exists buybox_tags;
    drop table if exists sku_tags;
  `);
};
