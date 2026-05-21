/**
 * Auto-generate products from synced SKUs. Groups SKUs by ASIN so the Products
 * page surfaces one row per listing (with channel prices on the columns)
 * instead of one row per SKU.
 *
 * Idempotent — re-runs only insert new ASINs and refresh the linked sku_ids
 * for ASINs whose SKU membership changed. Never overwrites the product `name`
 * once it's set (so a user-edited product label survives subsequent syncs).
 */
import { sql, jsonb } from "../db.js";
import { logger } from "../logger.js";

export interface ProductsSyncResult {
  inserted: number;
  updated: number;
}

interface SkuRow {
  id: string;
  sku: string;
  asin: string;
  title: string;
}

function pickBestTitle(rows: SkuRow[]): string {
  // Longest title that isn't the SKU code itself — that's the one we got from
  // the listings report (or Catalog Items enrichment). If none qualifies fall
  // back to the first available title so the product name isn't blank.
  const proper = rows
    .map((r) => r.title)
    .filter((t) => t && !rows.some((r) => r.sku === t))
    .sort((a, b) => b.length - a.length);
  return proper[0] ?? rows[0]?.title ?? rows[0]?.sku ?? "Untitled";
}

export async function syncProductsFromSkus(
  workspaceId: string,
): Promise<ProductsSyncResult> {
  const skus = await sql<SkuRow[]>`
    select id, sku, coalesce(asin,'') as asin, title
      from skus
     where workspace_id = ${workspaceId}
       and asin is not null and asin <> ''
  `;

  // Group SKUs by ASIN — each ASIN becomes one product row.
  const byAsin = new Map<string, SkuRow[]>();
  for (const s of skus) {
    if (!s.asin) continue;
    const arr = byAsin.get(s.asin) ?? [];
    arr.push(s);
    byAsin.set(s.asin, arr);
  }
  if (byAsin.size === 0) {
    logger.info({ workspaceId }, "syncProductsFromSkus: no ASIN-bearing SKUs");
    return { inserted: 0, updated: 0 };
  }

  // Existing products keyed by ASIN — used to decide insert vs. update.
  const existing = await sql<
    { id: string; asin: string; skuIds: string[]; name: string }[]
  >`
    select id, asin, sku_ids as "skuIds", name
      from products
     where workspace_id = ${workspaceId}
       and asin is not null
  `;
  const existingByAsin = new Map(existing.map((p) => [p.asin, p]));

  let inserted = 0;
  let updated = 0;

  for (const [asin, rows] of byAsin.entries()) {
    const skuIds = rows.map((r) => r.id);
    const cur = existingByAsin.get(asin);
    if (!cur) {
      const res = await sql`
        insert into products (workspace_id, asin, name, sku_ids)
        values (${workspaceId}, ${asin}, ${pickBestTitle(rows)}, ${jsonb(skuIds)})
        on conflict (workspace_id, asin) where asin is not null do nothing
        returning id
      `;
      if (res.length > 0) inserted += 1;
    } else {
      // Re-link if the SKU id set changed (e.g. a new channel was added).
      const same =
        cur.skuIds.length === skuIds.length &&
        cur.skuIds.every((id) => skuIds.includes(id));
      if (!same) {
        await sql`
          update products set sku_ids = ${jsonb(skuIds)}, updated_at = now()
           where id = ${cur.id}
        `;
        updated += 1;
      }
    }
  }

  logger.info(
    { workspaceId, inserted, updated, totalAsins: byAsin.size },
    "syncProductsFromSkus complete",
  );
  return { inserted, updated };
}
