/**
 * Amazon → DB sync, ported in 4 stages from the legacy price-scheduling-server
 * (its `Listing → Stock → MergedImage → SaleStock` pipeline, collapsed into our
 * single `skus` table):
 *
 *   1. syncListings   → GET_MERCHANT_LISTINGS_ALL_DATA report
 *                       writes title/asin/price/status/channel/image_url +
 *                       merchant_quantity + recomputes `stock`
 *   2. syncImages     → no-op for now (the listings report already carries
 *                       `image-url`); kept as a stage so the 8:30 BST cron has
 *                       a place to grow Catalog-API enrichment later
 *   3. syncFbaStock   → FBA inventory summaries → fba_fulfillable_quantity +
 *                       fba_pending_transship_quantity + fn_sku + recomputed
 *                       `stock`
 *   4. syncSales      → All-orders flat-file report → aggregate per SKU per
 *                       period (1D/7D/15D/30D) into sales_metrics + sales_30d
 *
 * `syncAmazonToSkus` chains all four for the manual "Sync from Amazon" button;
 * the staged BST crons in jobs.ts call each function individually.
 *
 * Upsert key is (workspace_id, sku, channel). User-owned fields (favorite,
 * tags, cost, base_price) are never touched.
 */
import { sql, jsonb } from "../db.js";
import { logger } from "../logger.js";
import { getAmazonProvider } from "./index.js";
import { aggregateOrders } from "./salesAggregator.js";

/** Amazon listing status → our `skus.status` enum. */
function mapStatus(amazon: string): string {
  return amazon.trim().toLowerCase().startsWith("active")
    ? "active"
    : "inactive";
}

const LISTING_COLS = [
  "workspace_id",
  "sku",
  "asin",
  "title",
  "image_url",
  "channel",
  "fulfillment_channel",
  "price",
  "merchant_quantity",
  "stock",
  "status",
] as const;

const CHUNK = 500;

export interface StageResult {
  stage: "listings" | "images" | "fba" | "sales";
  affected: number;
  mode: "live" | "stub";
}

/* ----------------------- 1. Listings stage ----------------------- */

export async function syncListings(workspaceId: string): Promise<StageResult> {
  const amazon = getAmazonProvider();
  const listings = await amazon.getMerchantListings();
  if (listings.length === 0) {
    logger.warn({ mode: amazon.mode }, "syncListings: no listings returned");
    return { stage: "listings", affected: 0, mode: amazon.mode };
  }

  const rows = listings.map((l) => ({
    workspace_id: workspaceId,
    sku: l.sku,
    asin: l.asin,
    title: l.title,
    image_url: l.imageUrl,
    channel: "amazon",
    fulfillment_channel: l.fulfillmentChannel,
    price: l.price ?? 0,
    merchant_quantity: l.quantity ?? 0,
    // Provisional stock = merchant + whatever FBA values we already have.
    // The FBA stage will recompute this with the latest summaries.
    stock: l.quantity ?? 0,
    status: mapStatus(l.status),
  }));

  let affected = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`
      insert into skus ${sql(chunk, ...LISTING_COLS)}
      on conflict (workspace_id, sku, channel) do update set
        title               = excluded.title,
        asin                = excluded.asin,
        image_url           = coalesce(excluded.image_url, skus.image_url),
        fulfillment_channel = excluded.fulfillment_channel,
        price               = case when excluded.price > 0
                                   then excluded.price else skus.price end,
        merchant_quantity   = excluded.merchant_quantity,
        stock               = excluded.merchant_quantity
                              + skus.fba_fulfillable_quantity
                              + skus.fba_pending_transship_quantity,
        status              = excluded.status,
        updated_at          = now()
    `;
    affected += chunk.length;
  }

  logger.info({ workspaceId, affected }, "syncListings complete");
  return { stage: "listings", affected, mode: amazon.mode };
}

/* ------------------------ 2. Image stage ------------------------- */

const IMAGE_PACE_MS = 250;
const IMAGE_FAIL_ABORT = 10; // bail out if this many consecutive failures

/**
 * Backfill image_url + fn_sku via SP-API Listings Items (per-SKU call paced at
 * 250ms). Mirrors the legacy app's image-merge stage, which called the same
 * SP-API endpoint via its `api.priceobo.com/image/{sku}` wrapper.
 *
 * Only processes active SKUs missing an image (so subsequent runs are cheap).
 */
export async function syncImages(workspaceId: string): Promise<StageResult> {
  const amazon = getAmazonProvider();
  if (amazon.mode === "stub") {
    return { stage: "images", affected: 0, mode: "stub" };
  }

  // Pick SKUs that need EITHER image OR a real title (the merchant listings
  // report often has empty `item-name`, so we fall back to the SKU; the
  // Listings Items API returns the proper itemName). Includes inactive SKUs
  // so the Lost Buy Box page can show images for ASINs we're not currently
  // winning — those rows often correspond to inactive listings.
  const targets = await sql<{ id: string; sku: string; title: string }[]>`
    select id, sku, title from skus
    where workspace_id = ${workspaceId}
      and (image_url is null or title = sku or title is null or title = '')
  `;
  if (targets.length === 0) {
    logger.info({ workspaceId }, "syncImages: nothing to enrich");
    return { stage: "images", affected: 0, mode: "live" };
  }

  logger.info(
    `   🖼  enriching ${targets.length} active SKUs (image / fn_sku / title) paced @ ${IMAGE_PACE_MS}ms…`,
  );

  let affected = 0;
  let consecFails = 0;
  for (let i = 0; i < targets.length; i++) {
    const { id, sku, title } = targets[i];
    try {
      const { imageUrl, fnSku, itemName } = await amazon.getListingSummary(sku);
      // Only overwrite title when current title is the SKU fallback (so a
      // user-edited title isn't clobbered).
      const newTitle =
        itemName && (title === sku || !title) ? itemName : null;
      if (imageUrl || fnSku || newTitle) {
        await sql`
          update skus set
            image_url = coalesce(${imageUrl}, image_url),
            fn_sku    = coalesce(${fnSku}, fn_sku),
            title     = coalesce(${newTitle}, title),
            updated_at = now()
          where id = ${id}
        `;
        affected += 1;
      }
      consecFails = 0;
    } catch (err) {
      consecFails += 1;
      logger.warn(
        { sku, err: err instanceof Error ? err.message : String(err) },
        "syncImages: single-SKU fetch failed",
      );
      if (consecFails >= IMAGE_FAIL_ABORT) {
        logger.error(
          { workspaceId, consecFails, processed: i + 1 },
          "syncImages: too many consecutive failures, aborting stage",
        );
        throw new Error(
          `Image enrichment aborted after ${consecFails} consecutive failures (processed ${i + 1}/${targets.length}). Likely SP-API quota — retry later.`,
        );
      }
    }
    if ((i + 1) % 100 === 0) {
      logger.info(
        `   🖼  progress ${i + 1}/${targets.length} — ${affected} enriched so far`,
      );
    }
    await new Promise((r) => setTimeout(r, IMAGE_PACE_MS));
  }

  logger.info({ workspaceId, affected }, "syncImages complete");
  return { stage: "images", affected, mode: "live" };
}

/* ------------------------ 3. FBA stage --------------------------- */

export async function syncFbaStock(workspaceId: string): Promise<StageResult> {
  const amazon = getAmazonProvider();
  // Let errors propagate so syncAmazonToSkus' wrapper records ok:false with
  // the real message (was swallowing 429 + returning success-with-0-rows).
  const fba = await amazon.getFbaInventory();
  if (fba.size === 0) {
    return { stage: "fba", affected: 0, mode: amazon.mode };
  }

  // Bulk update via jsonb_array_elements join — one round-trip per chunk.
  const tuples = [...fba.entries()].map(([sku, q]) => ({
    sku,
    fulfillable: q.fulfillable,
    pending: q.pendingTransship,
  }));

  let affected = 0;
  for (let i = 0; i < tuples.length; i += CHUNK) {
    const chunk = tuples.slice(i, i + CHUNK);
    const res = await sql`
      update skus s set
        fba_fulfillable_quantity       = (e->>'fulfillable')::int,
        fba_pending_transship_quantity = (e->>'pending')::int,
        stock = s.merchant_quantity
                + (e->>'fulfillable')::int
                + (e->>'pending')::int,
        updated_at = now()
      from jsonb_array_elements(${jsonb(chunk)}) as e
      where s.workspace_id = ${workspaceId} and s.sku = e->>'sku'
    `;
    affected += res.count ?? 0;
  }

  logger.info({ workspaceId, affected }, "syncFbaStock complete");
  return { stage: "fba", affected, mode: amazon.mode };
}

/* ----------------------- 4. Sales stage -------------------------- */

export async function syncSales(workspaceId: string): Promise<StageResult> {
  const amazon = getAmazonProvider();
  // Same as FBA stage — let errors propagate to the outer wrapper.
  const orders = await amazon.getOrdersReport(30);
  if (orders.length === 0) {
    return { stage: "sales", affected: 0, mode: amazon.mode };
  }

  const aggregates = aggregateOrders(orders);
  if (aggregates.length === 0) {
    return { stage: "sales", affected: 0, mode: amazon.mode };
  }

  let affected = 0;
  for (let i = 0; i < aggregates.length; i += CHUNK) {
    const chunk = aggregates.slice(i, i + CHUNK);
    const res = await sql`
      update skus s set
        sales_metrics = e->'metrics',
        sales_30d     = (e->>'units30d')::int,
        updated_at    = now()
      from jsonb_array_elements(${jsonb(chunk)}) as e
      where s.workspace_id = ${workspaceId} and s.sku = e->>'sku'
    `;
    affected += res.count ?? 0;
  }

  logger.info({ workspaceId, affected }, "syncSales complete");
  return { stage: "sales", affected, mode: amazon.mode };
}

/* ---------------------- Combined pipeline ------------------------ */

export type StageOutcome =
  | (StageResult & { ok: true })
  | { ok: false; stage: StageResult["stage"]; error: string; mode: "live" | "stub" };

/**
 * Manual "Sync from Amazon" entry point — runs all 4 stages in sequence.
 * `onStage` is invoked after each stage (success or failure) so the caller
 * (jobs.ts) can broadcast progress + record activity per stage. Failure in
 * one stage is captured but the next stages still run.
 */
const STAGES: { key: StageResult["stage"]; label: string }[] = [
  { key: "listings", label: "Listings" },
  { key: "images", label: "Images" },
  { key: "fba", label: "FBA stock" },
  { key: "sales", label: "Sales metrics" },
];

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${r}s`;
}

export async function syncAmazonToSkus(
  workspaceId: string,
  onStage: (outcome: StageOutcome) => Promise<void> = async () => {},
): Promise<{ upserted: number; mode: "live" | "stub" }> {
  const t0 = Date.now();
  logger.info(
    `═══════════════ 🚀 SYNC START ═══════════════ workspace=${workspaceId}`,
  );

  const run = async (
    idx: number,
    name: StageResult["stage"],
    label: string,
    fn: () => Promise<StageResult>,
  ): Promise<StageOutcome> => {
    const sTag = `[${idx}/4] ${label}`;
    logger.info(`→ ${sTag} — starting…`);
    const ts = Date.now();
    try {
      const r = await fn();
      const dt = fmtDuration(Date.now() - ts);
      logger.info(
        `✓ ${sTag} — ${r.affected} rows in ${dt} (${r.mode})`,
      );
      const o: StageOutcome = { ok: true, ...r };
      await onStage(o);
      return o;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const dt = fmtDuration(Date.now() - ts);
      logger.error(`✗ ${sTag} — FAILED in ${dt}: ${msg}`);
      const o: StageOutcome = {
        ok: false,
        stage: name,
        error: msg,
        mode: "live",
      };
      await onStage(o);
      return o;
    }
  };

  const results: StageOutcome[] = [];
  for (let i = 0; i < STAGES.length; i++) {
    const s = STAGES[i];
    const stageFn =
      s.key === "listings" ? () => syncListings(workspaceId)
      : s.key === "images" ? () => syncImages(workspaceId)
      : s.key === "fba" ? () => syncFbaStock(workspaceId)
      : () => syncSales(workspaceId);
    results.push(await run(i + 1, s.key, s.label, stageFn));
  }

  const totalDt = fmtDuration(Date.now() - t0);
  const listingsRes = results[0];
  const affected = listingsRes.ok ? listingsRes.affected : 0;
  const mode = listingsRes.mode;
  const okCount = results.filter((r) => r.ok).length;
  logger.info(
    `═══════════════ 🏁 SYNC DONE in ${totalDt} ═══════════════ ${okCount}/4 stages ok · ${affected} SKUs (${mode})`,
  );
  return { upserted: affected, mode };
}
