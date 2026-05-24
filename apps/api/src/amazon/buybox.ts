/**
 * Buy-box loss detection. Ported verbatim (logic-for-logic) from the
 * standalone Missed-Buy-Box app's services/buyBoxAnalyzer.js.
 *
 * "Missed" = the configured seller is NOT the featured-offer winner:
 *   1. featured offer exists but winner sellerId != ours  → other_seller_winning
 *   2. no featured offer (suppressed / no buy box)         → no_featured_offer
 *   3. featured offer winner is anonymized / hidden        → unknown_winner_anonymized
 *   4. we are the winner                                   → won (excluded)
 */
import type {
  CompetitiveSummaryItem,
  CompetitiveSummaryResponse,
} from "./types.js";

interface Money {
  amount: number | null;
  currency: string | null;
}

interface Offer {
  sellerId?: string;
  listingPrice?: { amount?: number | string; currencyCode?: string };
  shippingOptions?: Array<{ price?: { amount?: number | string } }>;
}

interface SummaryBody {
  asin?: string;
  featuredBuyingOptions?: Array<{
    buyBoxWinner?: boolean;
    segmentedFeaturedOffers?: Offer[];
  }>;
  lowestPricedOffers?: Array<{ offers?: Offer[] }>;
}

export interface AnalyzedRow {
  asin: string;
  missed: boolean;
  reason:
    | "won"
    | "other_seller_winning"
    | "no_featured_offer"
    | "unknown_winner_anonymized"
    | "api_error";
  buyboxSellerId: string | null;
  buyboxPrice: number | null;
  myPrice: number | null;
}

export interface AnalyzeSummary {
  total: number;
  won: number;
  missed: number;
  missedOtherSeller: number;
  missedNoFeatured: number;
  missedAnonymized: number;
  errors: number;
}

function getMoneyParts(money: Offer["listingPrice"]): Money {
  if (!money || typeof money !== "object") {
    return { amount: null, currency: null };
  }
  const amount =
    typeof money.amount === "number"
      ? money.amount
      : Number(money.amount) || null;
  return { amount, currency: money.currencyCode ?? null };
}

function getFeaturedOffer(body: SummaryBody): Offer | null {
  const options = body.featuredBuyingOptions ?? [];
  for (const opt of options) {
    if (opt.buyBoxWinner === false) continue;
    const segs = opt.segmentedFeaturedOffers ?? [];
    if (segs.length > 0) return segs[0];
  }
  for (const opt of options) {
    const segs = opt.segmentedFeaturedOffers ?? [];
    if (segs.length > 0) return segs[0];
  }
  return null;
}

function findMyOffer(body: SummaryBody, sellerId: string): Offer | null {
  const groups = body.lowestPricedOffers ?? [];
  for (const g of groups) {
    const mine = (g.offers ?? []).find((o) => o.sellerId === sellerId);
    if (mine) return mine;
  }
  for (const opt of body.featuredBuyingOptions ?? []) {
    const mine = (opt.segmentedFeaturedOffers ?? []).find(
      (o) => o.sellerId === sellerId,
    );
    if (mine) return mine;
  }
  return null;
}

/**
 * Best-effort inference when SP-API returns no featuredBuyingOptions but
 * lowestPricedOffers still has active sellers — i.e. the product actually
 * has a Buy Box on the storefront ("Add to cart" visible) and the listing
 * just didn't surface via the featured-offer path. Returns the cheapest
 * offer from a non-self seller; null if no rival is selling.
 *
 * Without this we mis-report those ASINs as "no_featured_offer" even though
 * the customer experience clearly has a winner.
 */
function inferRivalFromLowest(
  body: SummaryBody,
  sellerId: string,
): Offer | null {
  const groups = body.lowestPricedOffers ?? [];
  let best: Offer | null = null;
  let bestPrice = Number.POSITIVE_INFINITY;
  for (const g of groups) {
    for (const o of g.offers ?? []) {
      if (o.sellerId && o.sellerId === sellerId) continue;
      const m = o.listingPrice;
      const amt =
        typeof m?.amount === "number" ? m.amount : Number(m?.amount);
      if (!Number.isFinite(amt)) continue;
      if (amt < bestPrice) {
        bestPrice = amt;
        best = o;
      }
    }
  }
  return best;
}

function analyzeResponse(
  response: CompetitiveSummaryItem,
  fallbackAsin: string,
  sellerId: string,
): AnalyzedRow {
  const status = response?.status?.statusCode;
  const body = (response?.body ?? {}) as SummaryBody & {
    errors?: unknown[];
  };
  const asin = body.asin || fallbackAsin;

  if (status === undefined || status >= 300) {
    return {
      asin,
      missed: true,
      reason: "api_error",
      buyboxSellerId: null,
      buyboxPrice: null,
      myPrice: null,
    };
  }

  const featured = getFeaturedOffer(body);
  const myOffer = sellerId ? findMyOffer(body, sellerId) : null;
  const myPrice = myOffer
    ? getMoneyParts(myOffer.listingPrice)
    : { amount: null, currency: null };

  let missed = false;
  let reason: AnalyzedRow["reason"] = "won";
  let buyBoxPrice = featured
    ? getMoneyParts(featured.listingPrice)
    : { amount: null, currency: null };
  let buyboxSellerId: string | null = featured?.sellerId ?? null;

  if (featured) {
    if (!featured.sellerId) {
      missed = true;
      reason = "unknown_winner_anonymized";
    } else if (featured.sellerId !== sellerId) {
      missed = true;
      reason = "other_seller_winning";
    }
  } else {
    // No featuredBuyingOptions in the response. Before reporting "no
    // featured offer" (which the user often disputes — the storefront
    // shows "Add to cart" because a competing seller has the Buy Box),
    // see if lowestPricedOffers has any rival selling the item. If so,
    // treat the cheapest rival offer as the de-facto winner.
    const rival = sellerId ? inferRivalFromLowest(body, sellerId) : null;
    if (rival) {
      missed = true;
      reason = "other_seller_winning";
      buyboxSellerId = rival.sellerId ?? null;
      buyBoxPrice = getMoneyParts(rival.listingPrice);
    } else {
      missed = true;
      reason = "no_featured_offer";
    }
  }

  return {
    asin,
    missed,
    reason,
    buyboxSellerId,
    buyboxPrice: buyBoxPrice.amount,
    myPrice: myPrice.amount,
  };
}

export function analyze(
  spApiResponse: CompetitiveSummaryResponse,
  asinList: string[],
  sellerId: string,
): { rows: AnalyzedRow[]; summary: AnalyzeSummary } {
  const responses = spApiResponse?.responses ?? [];
  const rows = responses.map((r, i) =>
    analyzeResponse(r, asinList[i], sellerId),
  );
  const summary: AnalyzeSummary = {
    total: rows.length,
    won: rows.filter((r) => !r.missed).length,
    missed: rows.filter((r) => r.missed).length,
    missedOtherSeller: rows.filter((r) => r.reason === "other_seller_winning")
      .length,
    missedNoFeatured: rows.filter((r) => r.reason === "no_featured_offer")
      .length,
    missedAnonymized: rows.filter(
      (r) => r.reason === "unknown_winner_anonymized",
    ).length,
    errors: rows.filter((r) => r.reason === "api_error").length,
  };
  return { rows, summary };
}
