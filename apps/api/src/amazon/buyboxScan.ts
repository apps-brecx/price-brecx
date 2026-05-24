/**
 * Lost Buy Box scan orchestrator. Ported from the Missed-Buy-Box app's
 * routes/pricing.js `analyze-all` flow, minus its SSE transport:
 *
 *   1. Merchant listings report → all active ASINs + SKU + product name
 *   2. getCompetitiveSummary in 20-ASIN batches (paced, with a slow retry pass)
 *   3. analyze() → keep only the ASINs we are NOT winning
 *
 * Progress is surfaced through an `onProgress` callback so the caller (the
 * pg-boss worker) can relay it over the websocket the way the original app
 * streamed Server-Sent Events.
 */
import { logger } from "../logger.js";
import type { LostBuyboxRow } from "@fbm/shared";
import { getAmazonProvider } from "./index.js";
import { analyze, type AnalyzeSummary } from "./buybox.js";
import { ScanCancelledError, type RunCtl } from "./scanControl.js";
import type { CompetitiveSummaryItem } from "./types.js";

export interface ScanProgress {
  phase: "report" | "pricing" | "retry" | "analyze";
  message: string;
  processed?: number;
  total?: number;
  batch?: number;
  totalBatches?: number;
}

export interface ScanResult {
  marketplaceId: string | null;
  inventoryCount: number;
  rows: LostBuyboxRow[];
  summary: AnalyzeSummary;
  erroredAsins: string[];
}

const BATCH = 20;
const PACE_MS = Number(process.env.SP_API_BATCH_DELAY_MS) || 3_000;
/** How many in-flight batches at once. SP-API competitiveSummary's token
 *  bucket allows short bursts, so 3 parallel chains finish in roughly 1/3
 *  the wall time without tripping QuotaExceeded under normal load. */
const PARALLELISM = Number(process.env.SP_API_BATCH_CONCURRENCY) || 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isInactive(status: string): boolean {
  return /inactive|cancelled|closed/i.test(status);
}

async function runBatched(
  asins: string[],
  paceMs: number,
  onProgress: (p: ScanProgress) => void,
  phase: "pricing" | "retry",
  runCtl?: RunCtl,
): Promise<{ responses: CompetitiveSummaryItem[]; asins: string[] }> {
  const amazon = getAmazonProvider();
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += BATCH) {
    chunks.push(asins.slice(i, i + BATCH));
  }
  /** Index → response slot, so we can re-assemble the parallel results back
   *  into source-order. Sparse during the run, filled fully at the end. */
  const responses: (CompetitiveSummaryItem | null)[] = new Array(
    chunks.length * BATCH,
  ).fill(null);
  const asinsOut: (string | null)[] = new Array(chunks.length * BATCH).fill(
    null,
  );
  let done = 0;

  async function processChunk(idx: number): Promise<void> {
    if (runCtl?.cancel) throw new ScanCancelledError();
    const chunk = chunks[idx];
    const base = idx * BATCH;
    try {
      const result = await amazon.getCompetitiveSummary(chunk);
      for (let j = 0; j < chunk.length; j++) {
        responses[base + j] = result.responses[j] ?? null;
        asinsOut[base + j] = chunk[j];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ batch: idx + 1, msg }, "Buy Box batch failed");
      for (let j = 0; j < chunk.length; j++) {
        responses[base + j] = {
          status: { statusCode: 500 },
          body: { asin: chunk[j], errors: [{ message: msg }] },
        };
        asinsOut[base + j] = chunk[j];
      }
    }
    done++;
    onProgress({
      phase,
      message:
        phase === "retry"
          ? `Retrying errored ASINs… ${done}/${chunks.length} batches`
          : `Checking Buy Box… ${done}/${chunks.length} batches`,
      processed: done * BATCH,
      total: asins.length,
      batch: done,
      totalBatches: chunks.length,
    });
  }

  // Run `PARALLELISM` chains; each pulls the next chunk off a shared queue
  // with `paceMs` spacing between its own requests. Net throughput ≈
  // PARALLELISM × (1 chunk per paceMs).
  let next = 0;
  async function chain() {
    while (true) {
      const i = next++;
      if (i >= chunks.length) return;
      await processChunk(i);
      if (next < chunks.length) await sleep(paceMs);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARALLELISM, chunks.length) }, chain),
  );

  return {
    responses: responses
      .slice(0, done * BATCH)
      .filter((r): r is CompetitiveSummaryItem => r != null),
    asins: asinsOut.slice(0, done * BATCH).filter((a): a is string => a != null),
  };
}

export async function runLostBuyboxScan(
  ignoredAsins: Set<string>,
  onProgress: (p: ScanProgress) => void = () => {},
  runCtl?: RunCtl,
): Promise<ScanResult> {
  const amazon = getAmazonProvider();
  const sellerId = amazon.sellerId;

  onProgress({ phase: "report", message: "Requesting listings from Amazon…" });
  const listings = await amazon.getMerchantListings();
  if (runCtl?.cancel) throw new ScanCancelledError();

  const active = listings.filter((l) => !isInactive(l.status));
  const filtered = active.filter(
    (l) => l.asin && !ignoredAsins.has(l.asin.toUpperCase()),
  );
  const skipped = active.length - filtered.length;

  const asinList = [
    ...new Set(filtered.map((l) => l.asin!.toUpperCase())),
  ];
  const byAsin = new Map<string, (typeof filtered)[number]>();
  const skusByAsin = new Map<string, string[]>();
  for (const l of filtered) {
    const key = l.asin!.toUpperCase();
    const cur = byAsin.get(key);
    if (!cur || (l.quantity ?? 0) > (cur.quantity ?? 0)) byAsin.set(key, l);
    if (l.sku) {
      const arr = skusByAsin.get(key) ?? [];
      if (!arr.includes(l.sku)) arr.push(l.sku);
      skusByAsin.set(key, arr);
    }
  }

  onProgress({
    phase: "report",
    message: `${asinList.length} ASINs to check${
      skipped > 0 ? ` (${skipped} ignored, skipped)` : ""
    }.`,
    total: asinList.length,
  });

  const emptySummary: AnalyzeSummary = {
    total: 0,
    won: 0,
    missed: 0,
    missedOtherSeller: 0,
    missedNoFeatured: 0,
    missedAnonymized: 0,
    errors: 0,
  };

  if (asinList.length === 0 || !sellerId) {
    return {
      marketplaceId: null,
      inventoryCount: listings.length,
      rows: [],
      summary: emptySummary,
      erroredAsins: [],
    };
  }

  // First pass
  const first = await runBatched(
    asinList,
    PACE_MS,
    onProgress,
    "pricing",
    runCtl,
  );
  if (runCtl?.cancel) throw new ScanCancelledError();

  // Retry errored ASINs once, slower
  const errored: string[] = [];
  first.responses.forEach((r, i) => {
    if (!r?.status || (r.status.statusCode ?? 500) >= 300) {
      errored.push(first.asins[i]);
    }
  });

  let mergedResponses = first.responses;
  let mergedAsins = first.asins;
  if (errored.length > 0) {
    onProgress({
      phase: "retry",
      message: `Retrying ${errored.length} errored ASINs…`,
      total: errored.length,
    });
    const retry = await runBatched(
      errored,
      Math.max(PACE_MS * 2, 6_000),
      onProgress,
      "retry",
      runCtl,
    );
    const retryByAsin = new Map<string, CompetitiveSummaryItem>();
    retry.responses.forEach((r, i) => retryByAsin.set(retry.asins[i], r));
    mergedResponses = first.responses.map((orig, i) => {
      const retried = retryByAsin.get(first.asins[i]);
      if (!retried) return orig;
      if (!orig?.status || (orig.status.statusCode ?? 500) >= 300) {
        return retried;
      }
      return orig;
    });
    mergedAsins = first.asins;
  }

  onProgress({ phase: "analyze", message: "Analyzing Buy Box ownership…" });
  const { rows: allRows, summary } = analyze(
    { responses: mergedResponses },
    mergedAsins,
    sellerId,
  );

  const rows: LostBuyboxRow[] = allRows
    .filter((r) => r.missed && r.reason !== "api_error")
    .map((r) => {
      const key = r.asin.toUpperCase();
      const l = byAsin.get(key);
      const skus = skusByAsin.get(key) ?? [];
      return {
        asin: r.asin,
        sellerSku: l?.sku ?? skus[0] ?? null,
        skus,
        productName: l?.title ?? null,
        imageUrl: l?.imageUrl ?? null,
        myPrice: r.myPrice,
        buyboxPrice: r.buyboxPrice,
        buyboxSellerId: r.buyboxSellerId,
        reason: r.reason,
      };
    });

  // Backfill title + image for rows where the merchant listings report didn't
  // give us either (common for bundles / inactive SKUs). Catalog Items API is
  // the seller-agnostic source — it returns the public Amazon product data.
  const needCatalog = rows.filter(
    (r) =>
      !r.imageUrl ||
      !r.productName ||
      // listings fell back to the SKU when item-name was blank
      (r.sellerSku && r.productName === r.sellerSku) ||
      r.skus.includes(r.productName ?? ""),
  );
  if (needCatalog.length > 0) {
    onProgress({
      phase: "analyze",
      message: `Enriching ${needCatalog.length} ASINs from Catalog Items…`,
      total: needCatalog.length,
    });
    try {
      const catalog = await amazon.getCatalogSummariesByAsin(
        needCatalog.map((r) => r.asin.toUpperCase()),
      );
      for (const r of rows) {
        const c = catalog.get(r.asin.toUpperCase());
        if (!c) continue;
        if (c.itemName && (!r.productName || r.productName === r.sellerSku || r.skus.includes(r.productName))) {
          r.productName = c.itemName;
        }
        if (c.imageUrl && !r.imageUrl) {
          r.imageUrl = c.imageUrl;
        }
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Catalog enrichment skipped",
      );
    }
  }

  const erroredAsins = allRows
    .filter((r) => r.reason === "api_error")
    .map((r) => r.asin);

  return {
    marketplaceId: null,
    inventoryCount: listings.length,
    rows,
    summary,
    erroredAsins,
  };
}
