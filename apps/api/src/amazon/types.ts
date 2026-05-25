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

/** One row of the All Orders flat-file report (fields we use for sales aggregation). */
export interface OrderRow {
  amazonOrderId: string;
  purchaseDate: Date;
  sku: string;
  asin: string | null;
  quantity: number;
  itemPrice: number;
  itemStatus: string;
}

export interface AmazonProvider {
  readonly mode: "live" | "stub";
  /** The configured seller id, or null in stub mode. Needed by the buy-box
   *  analyzer to decide whether *we* are the featured-offer winner. */
  readonly sellerId: string | null;
  /** Push a new price for a SKU to the marketplace. */
  updatePrice(sku: string, price: number): Promise<{ ok: boolean; detail?: unknown }>;
  /** Amazon Deal pricing — sets a `discounted_price` window on the listing.
   *  Different from `updatePrice`: Amazon enforces the start/end on its side
   *  rather than us scheduling apply/revert jobs. */
  updateSalePrice(
    sku: string,
    value: number,
    startDate: string,
    endDate: string,
  ): Promise<{ ok: boolean; detail?: unknown }>;
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
  /** All-orders flat-file report for the last `daysBack` days. Drives the
   *  per-SKU sales-metrics aggregator (1D / 7D / 15D / 30D buckets). */
  getOrdersReport(daysBack: number): Promise<OrderRow[]>;
  /** All-orders flat-file report for an explicit [start, end] window. Used by
   *  the historical-backfill worker to chunk a wider range into 30-day pieces
   *  (BY_LAST_UPDATE_GENERAL silently returns an empty document past ~60d). */
  getOrdersReportInRange(
    dataStartTime: string,
    dataEndTime: string,
  ): Promise<OrderRow[]>;
  /** Listings Items API v2021-08-01 GET by SKU with `includedData=summaries`.
   *  Returns the main product image + FBA barcode + display title. The legacy
   *  app called this per SKU via its `api.priceobo.com/image/{sku}` wrapper. */
  getListingSummary(sku: string): Promise<{
    imageUrl: string | null;
    fnSku: string | null;
    itemName: string | null;
  }>;
  /** Catalog Items API v2022-04-01 batch lookup by ASIN. Returns the public
   *  product title + main image — used as a fallback when the seller's own
   *  Listings entry has no item-name / image (e.g. bundles, inactive SKUs).
   *  SP-API hard cap is 20 ASINs per call. */
  getCatalogSummariesByAsin(asins: string[]): Promise<
    Map<string, { itemName: string | null; imageUrl: string | null }>
  >;
  /** Sales API v1 — `/sales/v1/orderMetrics`. Daily / monthly unit count +
   *  average price for a single SKU or ASIN. Fast (seconds), cheap on quota,
   *  and ideal for the per-SKU sales report inside the schedule drawer. */
  getOrderMetrics(opts: {
    identifier: string;
    identifierType: "sku" | "asin";
    granularity: "Day" | "Month";
    startDate: string; // YYYY-MM-DD
    endDate: string;
  }): Promise<OrderMetric[]>;
  /** Workspace-wide variant of getOrderMetrics — no per-SKU/ASIN filter.
   *  Used by the deep-backfill worker to seed daily_workspace_sales for
   *  charts spanning up to ~2 years. Max 31 days per call. */
  getOrderMetricsWorkspace(opts: {
    granularity: "Day" | "Month";
    startDate: string;
    endDate: string;
  }): Promise<OrderMetric[]>;
}

export interface OrderMetric {
  /** ISO start of the interval bucket (Day or Month start). */
  intervalStart: string;
  unitCount: number;
  averageAmount: number;
}

export interface FbaQty {
  fulfillable: number;
  pendingTransship: number;
}
