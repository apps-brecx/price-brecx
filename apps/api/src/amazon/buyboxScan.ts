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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isInactive(status: string): boolean {
  return /inactive|cancelled|closed/i.test(status);
}

async function runBatched(
  asins: string[],
  paceMs: number,
  onProgress: (p: ScanProgress) => void,
  phase: "pricing" | "retry",
): Promise<{ responses: CompetitiveSummaryItem[]; asins: string[] }> {
  const amazon = getAmazonProvider();
  const chunks: string[][] = [];
  for (let i = 0; i < asins.length; i += BATCH) {
    chunks.push(asins.slice(i, i + BATCH));
  }
  const allResponses: CompetitiveSummaryItem[] = [];
  const allAsins: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const result = await amazon.getCompetitiveSummary(chunk);
      allResponses.push(...result.responses);
      allAsins.push(...chunk);
    } catch (err) {
      // A whole-batch failure shouldn't abort the scan — synthesize error
      // responses so these ASINs flow through to the retry pass instead.
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ batch: i + 1, msg }, "Buy Box batch failed");
      for (const asin of chunk) {
        allResponses.push({
          status: { statusCode: 500 },
          body: { asin, errors: [{ message: msg }] },
        });
        allAsins.push(asin);
      }
    }
    onProgress({
      phase,
      message: `Checking Buy Box… batch ${i + 1}/${chunks.length}`,
      processed: allAsins.length,
      total: asins.length,
      batch: i + 1,
      totalBatches: chunks.length,
    });
    if (i < chunks.length - 1) await sleep(paceMs);
  }
  return { responses: allResponses, asins: allAsins };
}

export async function runLostBuyboxScan(
  ignoredAsins: Set<string>,
  onProgress: (p: ScanProgress) => void = () => {},
): Promise<ScanResult> {
  const amazon = getAmazonProvider();
  const sellerId = amazon.sellerId;

  onProgress({ phase: "report", message: "Requesting listings from Amazon…" });
  const listings = await amazon.getMerchantListings();

  const active = listings.filter((l) => !isInactive(l.status));
  const filtered = active.filter(
    (l) => l.asin && !ignoredAsins.has(l.asin.toUpperCase()),
  );
  const skipped = active.length - filtered.length;

  const asinList = [
    ...new Set(filtered.map((l) => l.asin!.toUpperCase())),
  ];
  const byAsin = new Map<string, (typeof filtered)[number]>();
  for (const l of filtered) {
    const key = l.asin!.toUpperCase();
    const cur = byAsin.get(key);
    if (!cur || (l.quantity ?? 0) > (cur.quantity ?? 0)) byAsin.set(key, l);
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
  const first = await runBatched(asinList, PACE_MS, onProgress, "pricing");

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
      const l = byAsin.get(r.asin.toUpperCase());
      return {
        asin: r.asin,
        sellerSku: l?.sku ?? null,
        productName: l?.title ?? null,
        myPrice: r.myPrice,
        buyboxPrice: r.buyboxPrice,
        buyboxSellerId: r.buyboxSellerId,
        reason: r.reason,
      };
    });

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
