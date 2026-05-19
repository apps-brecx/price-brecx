export interface SpapiCredentials {
  refreshToken: string;
  lwaAppId: string;
  lwaClientSecret: string;
  sellerId: string;
  marketplaceId: string;
  endpoint: string;
}

export interface ProductOffer {
  sku: string;
  asin: string | null;
  title: string | null;
  price: number | null;
  currency: string;
}

/** One row of the GET_MERCHANT_LISTINGS_ALL_DATA report (fields we use). */
export interface ListingRow {
  sku: string;
  asin: string | null;
  title: string;
  price: number | null;
  /** Quantity from the listings report (merchant-managed stock). */
  quantity: number;
  imageUrl: string | null;
  /** e.g. "DEFAULT" (FBM) or "AMAZON_NA" (FBA). */
  fulfillmentChannel: string | null;
  /** Raw Amazon status string, e.g. "Active" / "Inactive". */
  status: string;
}

/**
 * One item in a getCompetitiveSummary batch response. Kept permissive — the
 * buy-box analyzer reaches into nested optional fields and tolerates gaps.
 */
export interface CompetitiveSummaryItem {
  status?: { statusCode?: number };
  body?: {
    asin?: string;
    errors?: Array<{ code?: string; message?: string }>;
    featuredBuyingOptions?: unknown[];
    lowestPricedOffers?: unknown[];
    referencePrices?: unknown[];
  };
}

export interface CompetitiveSummaryResponse {
  responses: CompetitiveSummaryItem[];
}

export interface AmazonProvider {
  readonly mode: "live" | "stub";
  /** The configured seller id, or null in stub mode. Needed by the buy-box
   *  analyzer to decide whether *we* are the featured-offer winner. */
  readonly sellerId: string | null;
  /** Push a new price for a SKU to the marketplace. */
  updatePrice(sku: string, price: number): Promise<{ ok: boolean; detail?: unknown }>;
  /** Fetch the current offer/pricing for a SKU. */
  getOffer(sku: string): Promise<ProductOffer | null>;
  /** Fetch catalog details for an ASIN. */
  getCatalogItem(asin: string): Promise<unknown>;
  /** Pull every listing via the merchant listings report. */
  getMerchantListings(): Promise<ListingRow[]>;
  /** seller-SKU → FBA quantities. Legacy channel stock sums both with the
   *  report quantity: fulfillable + pendingTransship + report quantity. */
  getFbaInventory(): Promise<Map<string, FbaQty>>;
  /** Product Pricing API v2022-05-01 getCompetitiveSummary, batched. Caller
   *  must pass ≤20 ASINs per call (the SP-API hard cap). */
  getCompetitiveSummary(asins: string[]): Promise<CompetitiveSummaryResponse>;
}

export interface FbaQty {
  fulfillable: number;
  pendingTransship: number;
}
