/**
 * NineYard → DB sync. Replaces the per-Amazon-SPI 4-stage pipeline with a
 * single source-of-truth API:
 *
 *   1. Items stage — paginate /api/Items, upsert into nineyard_items.
 *      Master inventory + image + title + total stock.
 *
 *   2. Skus stage  — paginate /api/Skus (100/page), upsert into skus keyed by
 *      (workspace_id, account_sku_id). One row per (account × channel).
 *
 *   3. Mappings stage — bulk GET /api/Skus/GetSkuMappings to set
 *      skus.nineyard_item_id (and back-fill image/title from the master item
 *      when the listing has none).
 *
 * User-owned fields (favorite, tags, base_price, cost overrides) are never
 * touched. All other columns reflect the upstream NineYard state.
 */
import { sql, jsonb } from "../db.js";
import { logger } from "../logger.js";
import {
  iterateAllItems,
  iterateAllSkus,
  getItemLocations,
  getSkuMappings,
  nineyardReady,
} from "./client.js";
import type { NyApiItem, NyApiSku } from "./types.js";

export interface NinyardSyncSummary {
  items: number;
  skus: number;
  mapped: number;
  warehouseItems: number;
  mode: "live" | "skipped";
}

const ITEM_CHUNK = 250;
const SKU_CHUNK = 250;

/* ----------------------- channel/status maps ----------------------- */

/** NineYard channel labels → brecx canonical lowercased channel slugs. */
function normalizeChannel(c: string | null | undefined): string {
  if (!c) return "unknown";
  const s = c.trim().toLowerCase();
  if (s === "amazon") return "amazon";
  if (s === "walmart") return "walmart";
  if (s === "shopify") return "shopify";
  if (s === "ebay") return "ebay";
  if (s === "tiktok") return "tiktok";
  if (s === "wholesale") return "wholesale";
  if (s === "mirakl") return "mirakl";
  return s;
}

/** NineYard `fulfillmentType` ("fbm"/"fba"/null) → legacy fulfillment_channel
 *  string the rest of brecx already understands. */
function normalizeFulfillment(f: string | null | undefined): string | null {
  if (!f) return null;
  const s = f.trim().toLowerCase();
  if (s === "fbm") return "DEFAULT";
  if (s === "fba") return "AMAZON_NA";
  return f;
}

/* --------------------------- Items stage --------------------------- */

async function upsertItems(
  workspaceId: string,
  items: NyApiItem[],
): Promise<void> {
  if (items.length === 0) return;
  // Dedupe within the batch — NineYard occasionally returns the same itemId
  // twice (e.g. paging boundaries, listing variants), which makes Postgres
  // refuse the upsert with "ON CONFLICT cannot affect row a second time".
  // Last write wins; the data is identical 99% of the time anyway.
  const dedup = new Map<number, NyApiItem>();
  for (const it of items) dedup.set(it.itemId, it);
  const deduped = [...dedup.values()];
  const rows = deduped.map((it) => ({
    workspace_id: workspaceId,
    nineyard_item_id: it.itemId,
    item_name: it.itemName,
    vendor_item_name: it.vendorItemName,
    title: it.title,
    brand: it.brand,
    image_url: it.imageUrl,
    vendor_name: it.vendorName,
    vendor_id: it.vendorId,
    qty_on_hand: it.qtyOnHand,
    local_stock: it.localstock,
    inbound_stock: it.inboundStock,
    total_stock: it.totalStock,
    cost: it.price,
    avg_price: it.avgPrice,
    case_qty: it.caseQty,
    lead_days: it.leadDays,
    purchase_days: it.purchaseDays,
    notes: it.notes,
    length: it.length,
    height: it.height,
    width: it.width,
    weight: it.weight,
    delete_flag: it.deleteFlag,
    ny_synced_at: new Date(),
  }));

  // postgres.js handles the column list via sql(rows, ...cols) — keep an
  // explicit tuple so future schema drift is loud, not silent.
  const COLS = [
    "workspace_id",
    "nineyard_item_id",
    "item_name",
    "vendor_item_name",
    "title",
    "brand",
    "image_url",
    "vendor_name",
    "vendor_id",
    "qty_on_hand",
    "local_stock",
    "inbound_stock",
    "total_stock",
    "cost",
    "avg_price",
    "case_qty",
    "lead_days",
    "purchase_days",
    "notes",
    "length",
    "height",
    "width",
    "weight",
    "delete_flag",
    "ny_synced_at",
  ] as const;

  for (let i = 0; i < rows.length; i += ITEM_CHUNK) {
    const chunk = rows.slice(i, i + ITEM_CHUNK);
    await sql`
      insert into nineyard_items ${sql(chunk, ...COLS)}
      on conflict (workspace_id, nineyard_item_id) do update set
        item_name        = excluded.item_name,
        vendor_item_name = excluded.vendor_item_name,
        title            = excluded.title,
        brand            = excluded.brand,
        image_url        = excluded.image_url,
        vendor_name      = excluded.vendor_name,
        vendor_id        = excluded.vendor_id,
        qty_on_hand      = excluded.qty_on_hand,
        local_stock      = excluded.local_stock,
        inbound_stock    = excluded.inbound_stock,
        total_stock      = excluded.total_stock,
        cost             = excluded.cost,
        avg_price        = excluded.avg_price,
        case_qty         = excluded.case_qty,
        lead_days        = excluded.lead_days,
        purchase_days    = excluded.purchase_days,
        notes            = excluded.notes,
        length           = excluded.length,
        height           = excluded.height,
        width            = excluded.width,
        weight           = excluded.weight,
        delete_flag      = excluded.delete_flag,
        ny_synced_at     = excluded.ny_synced_at,
        updated_at       = now()
    `;
  }
}

/* --------------------------- Skus stage --------------------------- */

async function upsertSkus(workspaceId: string, items: NyApiSku[]): Promise<void> {
  if (items.length === 0) return;

  // Same defensive dedupe as upsertItems — same accountSkuId twice in one
  // batch makes Postgres bail on the ON CONFLICT clause.
  const dedup = new Map<number, NyApiSku>();
  for (const s of items) dedup.set(s.accountSkuId, s);
  const deduped = [...dedup.values()];

  const rows = deduped.map((s) => {
    const channel = normalizeChannel(s.channel);
    return {
      workspace_id: workspaceId,
      sku: s.sku ?? "",
      // For Amazon listings, NineYard's channelId is the ASIN. Stash it in
      // both fields so existing buyer/buybox features keep working.
      asin: channel === "amazon" ? s.channelId : null,
      channel_id: s.channelId,
      title: s.title ?? s.sku ?? "",
      image_url: s.image,
      channel,
      fulfillment_channel: normalizeFulfillment(s.fulfillmentType),
      account: s.account,
      account_sku_id: s.accountSkuId,
      price: s.price ?? 0,
      base_price: null, // user-managed; never overwritten by sync
      cost: s.cost,
      stock: s.qty ?? 0,
      min_price: s.minPrice,
      max_price: s.maxPrice,
      default_price: s.defaultPrice,
      map_price: s.mapPrice,
      reserve: s.reserve,
      inbound_stock: s.inboundStock,
      prep_cost: s.prepCost,
      ship_cost: s.shipCost,
      markup: s.markup,
      min_markup: s.minMarkup,
      is_active: s.isActive,
      is_min_price_manual: s.isMinPriceManual,
      is_max_price_manual: s.isMaxPriceManual,
      is_map_active: s.isMapActive,
      price_model: s.priceModel,
      price_model_name: s.priceModelName,
      rank: s.rank,
      category: s.category,
      fba_type: s.fbaType,
      status: s.isActive ? "active" : "inactive",
      ny_synced_at: new Date(),
    };
  });

  const COLS = [
    "workspace_id",
    "sku",
    "asin",
    "channel_id",
    "title",
    "image_url",
    "channel",
    "fulfillment_channel",
    "account",
    "account_sku_id",
    "price",
    "base_price",
    "cost",
    "stock",
    "min_price",
    "max_price",
    "default_price",
    "map_price",
    "reserve",
    "inbound_stock",
    "prep_cost",
    "ship_cost",
    "markup",
    "min_markup",
    "is_active",
    "is_min_price_manual",
    "is_max_price_manual",
    "is_map_active",
    "price_model",
    "price_model_name",
    "rank",
    "category",
    "fba_type",
    "status",
    "ny_synced_at",
  ] as const;

  for (let i = 0; i < rows.length; i += SKU_CHUNK) {
    const chunk = rows.slice(i, i + SKU_CHUNK);
    await sql`
      insert into skus ${sql(chunk, ...COLS)}
      on conflict (workspace_id, account_sku_id) where account_sku_id is not null
      do update set
        sku                  = excluded.sku,
        asin                 = excluded.asin,
        channel_id           = excluded.channel_id,
        title                = excluded.title,
        image_url            = coalesce(excluded.image_url, skus.image_url),
        channel              = excluded.channel,
        fulfillment_channel  = excluded.fulfillment_channel,
        account              = excluded.account,
        price                = excluded.price,
        cost                 = coalesce(excluded.cost, skus.cost),
        stock                = excluded.stock,
        min_price            = excluded.min_price,
        max_price            = excluded.max_price,
        default_price        = excluded.default_price,
        map_price            = excluded.map_price,
        reserve              = excluded.reserve,
        inbound_stock        = excluded.inbound_stock,
        prep_cost            = excluded.prep_cost,
        ship_cost            = excluded.ship_cost,
        markup               = excluded.markup,
        min_markup           = excluded.min_markup,
        is_active            = excluded.is_active,
        is_min_price_manual  = excluded.is_min_price_manual,
        is_max_price_manual  = excluded.is_max_price_manual,
        is_map_active        = excluded.is_map_active,
        price_model          = excluded.price_model,
        price_model_name     = excluded.price_model_name,
        rank                 = excluded.rank,
        category             = excluded.category,
        fba_type             = excluded.fba_type,
        status               = excluded.status,
        ny_synced_at         = excluded.ny_synced_at,
        updated_at           = now()
    `;
  }
}

/* ----------------------- Mappings stage --------------------------- */

async function applyMappings(workspaceId: string): Promise<number> {
  const rows = await sql<{ accountSkuId: number }[]>`
    select account_sku_id as "accountSkuId"
      from skus
     where workspace_id = ${workspaceId}
       and account_sku_id is not null
       and nineyard_item_id is null
  `;
  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.accountSkuId);
  const mappings = await getSkuMappings(ids);

  // Bulk update via `unnest`. A per-row UPDATE inside a `for` loop costs
  // 11k+ Neon round-trips (~15 min); this batched form runs the whole set
  // in seconds.
  const pairs = mappings.flatMap((m) =>
    m.mappedItems?.[0]
      ? [{ accountSkuId: m.accountSkuId, itemId: m.mappedItems[0].itemId }]
      : [],
  );
  if (pairs.length === 0) return 0;

  const UPDATE_CHUNK = 1000;
  let touched = 0;
  for (let i = 0; i < pairs.length; i += UPDATE_CHUNK) {
    const chunk = pairs.slice(i, i + UPDATE_CHUNK);
    const accountSkuIds = chunk.map((p) => p.accountSkuId);
    const itemIds = chunk.map((p) => p.itemId);
    await sql`
      update skus s
         set nineyard_item_id = v.item_id,
             updated_at = now()
        from unnest(${accountSkuIds}::int[], ${itemIds}::int[])
          as v(account_sku_id, item_id)
       where s.workspace_id = ${workspaceId}
         and s.account_sku_id = v.account_sku_id
    `;
    touched += chunk.length;
  }

  // Backfill image/title from the master item when the listing has none.
  await sql`
    update skus s
       set image_url = coalesce(s.image_url, n.image_url),
           title     = case when s.title = '' or s.title is null
                            then coalesce(n.title, s.title)
                            else s.title end
      from nineyard_items n
     where s.workspace_id = ${workspaceId}
       and s.nineyard_item_id = n.nineyard_item_id
       and (s.image_url is null or s.title = '' or s.title is null)
  `;

  return touched;
}

/* ----------------------- Warehouse stock stage ------------------- */

/**
 * Per-master-item warehouse stock. NineYard's /api/Items/GetItemLocations
 * accepts only one ItemId per call, so we fan out in parallel chunks. The
 * result is flattened to `{ warehouseName: qty }` and stored on the item row.
 */
async function syncItemLocations(
  workspaceId: string,
): Promise<number> {
  const items = await sql<{ id: string; ny: number }[]>`
    select id, nineyard_item_id as "ny"
      from nineyard_items
     where workspace_id = ${workspaceId}
       and delete_flag = false
  `;
  if (items.length === 0) return 0;

  const PARALLEL = 6;
  let touched = 0;
  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = items.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async (it) => {
        const locs = await getItemLocations(it.ny);
        const map: Record<string, number> = {};
        for (const l of locs) {
          if (!l.warehouseName) continue;
          map[l.warehouseName] = (map[l.warehouseName] ?? 0) + l.qty;
        }
        return { id: it.id, map };
      }),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      // postgres.js double-encodes when given a JSON-stringified value with
      // `::jsonb` — the value lands as a JSON *string* containing the object,
      // not the object itself. The shared `jsonb()` helper (db.ts) uses
      // sql.json() which binds the object correctly as jsonb.
      await sql`
        update nineyard_items
           set warehouse_stock = ${jsonb(r.value.map)},
               updated_at = now()
         where id = ${r.value.id}
      `;
      touched++;
    }
  }
  return touched;
}

/* ---------------------- top-level orchestrator -------------------- */

export async function syncNineyardToSkus(
  workspaceId: string,
): Promise<NinyardSyncSummary> {
  if (!nineyardReady()) {
    logger.warn("NineYard sync skipped: credentials missing");
    return {
      items: 0,
      skus: 0,
      mapped: 0,
      warehouseItems: 0,
      mode: "skipped",
    };
  }

  // Stage 1 — master inventory items
  let items = 0;
  for await (const batch of iterateAllItems(200)) {
    await upsertItems(workspaceId, batch);
    items += batch.length;
  }
  logger.info({ workspaceId, items }, "NineYard items upserted");

  // Stage 2 — marketplace SKU listings (1 row per account × channel × sku)
  let skuCount = 0;
  for await (const batch of iterateAllSkus()) {
    await upsertSkus(workspaceId, batch);
    skuCount += batch.length;
  }
  logger.info({ workspaceId, skus: skuCount }, "NineYard skus upserted");

  // Stage 3 — connect each marketplace SKU back to its master item
  const mapped = await applyMappings(workspaceId);
  logger.info({ workspaceId, mapped }, "NineYard mappings applied");

  // Stage 4 — per-item warehouse stock breakdown (FBM, Shelves, …).
  // Slowest stage; ~250ms per item × 6-parallel ≈ 1-2 min for ~930 items.
  const warehouseItems = await syncItemLocations(workspaceId);
  logger.info(
    { workspaceId, warehouseItems },
    "NineYard item locations synced",
  );

  return { items, skus: skuCount, mapped, warehouseItems, mode: "live" };
}
