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
  const buyBoxPrice = featured
    ? getMoneyParts(featured.listingPrice)
    : { amount: null, currency: null };
  const myPrice = myOffer
    ? getMoneyParts(myOffer.listingPrice)
    : { amount: null, currency: null };

  let missed = false;
  let reason: AnalyzedRow["reason"] = "won";
  if (!featured) {
    missed = true;
    reason = "no_featured_offer";
  } else if (!featured.sellerId) {
    missed = true;
    reason = "unknown_winner_anonymized";
  } else if (featured.sellerId !== sellerId) {
    missed = true;
    reason = "other_seller_winning";
  }

  return {
    asin,
    missed,
    reason,
    buyboxSellerId: featured?.sellerId ?? null,
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
