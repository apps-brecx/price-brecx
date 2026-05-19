/**
 * Amazon → DB sync. Mirrors the legacy price-scheduling-server ETL but
 * collapses its 4 Mongo collections into our single `skus` table:
 *
 *   GET_MERCHANT_LISTINGS_ALL_DATA report  → title/asin/price/status/channel
 *   FBA inventory summaries                → channel stock
 *
 * Channel stock follows the legacy formula exactly:
 *   fulfillableQuantity + pendingTransshipmentQuantity + report quantity
 * (FBM SKUs aren't in the FBA response — their stock is the report quantity;
 * using only the FBA value made every FBM row read 0.)
 *
 * Upsert key is (workspace_id, sku, channel). Only Amazon-owned columns are
 * overwritten — user-managed fields (favorite, tags, cost, base_price) and
 * enrichment-owned fields (a real image_url, sales_30d) are preserved.
 */
import { sql } from "../db.js";
import { logger } from "../logger.js";
import { getAmazonProvider } from "./index.js";
import type { FbaQty } from "./types.js";

/** Amazon listing status → our `skus.status` enum. */
function mapStatus(amazon: string): string {
  return amazon.trim().toLowerCase().startsWith("active")
    ? "active"
    : "inactive";
}

const COLS = [
  "workspace_id",
  "sku",
  "asin",
  "title",
  "image_url",
  "channel",
  "fulfillment_channel",
  "price",
  "stock",
  "status",
] as const;

const CHUNK = 500;

export async function syncAmazonToSkus(
  workspaceId: string,
): Promise<{ upserted: number; mode: "live" | "stub" }> {
  const amazon = getAmazonProvider();

  const listings = await amazon.getMerchantListings();
  if (listings.length === 0) {
    logger.warn({ mode: amazon.mode }, "Amazon sync: no listings returned");
    return { upserted: 0, mode: amazon.mode };
  }

  // FBA stock is best-effort — a failure here shouldn't lose the listings,
  // FBM rows still get their stock from the report quantity.
  let fba = new Map<string, FbaQty>();
  try {
    fba = await amazon.getFbaInventory();
  } catch (err) {
    logger.error({ err }, "Amazon sync: FBA inventory fetch failed");
  }

  const rows = listings.map((l) => {
    const q = fba.get(l.sku);
    const stock =
      (q?.fulfillable ?? 0) + (q?.pendingTransship ?? 0) + (l.quantity ?? 0);
    return {
      workspace_id: workspaceId,
      sku: l.sku,
      asin: l.asin,
      title: l.title,
      image_url: l.imageUrl,
      channel: "amazon",
      fulfillment_channel: l.fulfillmentChannel,
      price: l.price ?? 0,
      stock,
      status: mapStatus(l.status),
    };
  });

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      insert into skus ${sql(chunk, ...COLS)}
      on conflict (workspace_id, sku, channel) do update set
        title               = excluded.title,
        asin                = excluded.asin,
        image_url           = coalesce(excluded.image_url, skus.image_url),
        fulfillment_channel = excluded.fulfillment_channel,
        price               = case when excluded.price > 0
                                   then excluded.price else skus.price end,
        stock               = excluded.stock,
        status              = excluded.status,
        updated_at          = now()
    `;
    upserted += chunk.length;
  }

  logger.info({ workspaceId, upserted }, "Amazon sync complete");
  return { upserted, mode: amazon.mode };
}
