import zlib from "node:zlib";
import axios from "axios";
import { logger } from "../logger.js";
import type {
  AmazonProvider,
  CompetitiveSummaryResponse,
  FbaQty,
  ListingRow,
  OrderRow,
  ProductOffer,
  SpapiCredentials,
} from "./types.js";

/**
 * Live Amazon Selling Partner API provider. Logic is ported from the previous
 * price-scheduling-server (LWA refresh-token grant + Listings/Catalog calls).
 */
export class SpapiProvider implements AmazonProvider {
  readonly mode = "live" as const;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly creds: SpapiCredentials) {}

  get sellerId(): string {
    return this.creds.sellerId;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    // LWA requires application/x-www-form-urlencoded. .trim() guards against
    // a stray newline/space pasted into the env value.
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.creds.refreshToken.trim(),
      client_id: this.creds.lwaAppId.trim(),
      client_secret: this.creds.lwaClientSecret.trim(),
    });
    try {
      const res = await axios.post(
        "https://api.amazon.com/auth/o2/token",
        body,
        { headers: { "content-type": "application/x-www-form-urlencoded" } },
      );
      this.accessToken = res.data.access_token as string;
      this.tokenExpiresAt = Date.now() + (res.data.expires_in ?? 3600) * 1000;
      return this.accessToken;
    } catch (err) {
      throw spError("LWA token", err);
    }
  }

  async updatePrice(sku: string, price: number) {
    const token = await this.getAccessToken();
    const url = `${this.creds.endpoint}/listings/2021-08-01/items/${
      this.creds.sellerId
    }/${encodeURIComponent(sku)}`;
    try {
      const res = await axios({
        method: "PATCH",
        url,
        headers: {
          "x-amz-access-token": token,
          "content-type": "application/json",
        },
        params: { marketplaceIds: this.creds.marketplaceId },
        data: {
          productType: "PRODUCT",
          patches: [
            {
              op: "replace",
              path: "/attributes/purchasable_offer",
              value: [
                {
                  marketplace_id: this.creds.marketplaceId,
                  currency: "USD",
                  our_price: [
                    { schedule: [{ value_with_tax: price.toFixed(2) }] },
                  ],
                },
              ],
            },
          ],
        },
      });
      return { ok: true, detail: res.data };
    } catch (err) {
      logger.error({ err, sku }, "SP-API updatePrice failed");
      return {
        ok: false,
        detail: axios.isAxiosError(err) ? err.response?.data : String(err),
      };
    }
  }

  async getOffer(sku: string): Promise<ProductOffer | null> {
    const token = await this.getAccessToken();
    const url = `${this.creds.endpoint}/listings/2021-08-01/items/${
      this.creds.sellerId
    }/${encodeURIComponent(sku)}`;
    try {
      const res = await axios.get(url, {
        headers: { "x-amz-access-token": token },
        params: {
          marketplaceIds: this.creds.marketplaceId,
          includedData: "summaries,offers,attributes",
        },
      });
      const data = res.data ?? {};
      const summary = data.summaries?.[0] ?? {};
      const offer = data.offers?.[0] ?? {};
      return {
        sku,
        asin: summary.asin ?? null,
        title: summary.itemName ?? null,
        price: offer.price?.amount ? Number(offer.price.amount) : null,
        currency: offer.price?.currencyCode ?? "USD",
      };
    } catch (err) {
      logger.error({ err, sku }, "SP-API getOffer failed");
      return null;
    }
  }

  async getCatalogItem(asin: string): Promise<unknown> {
    const token = await this.getAccessToken();
    const url = `${this.creds.endpoint}/catalog/v0/items/${asin}`;
    const res = await axios.get(url, {
      headers: { "x-amz-access-token": token },
      params: { MarketplaceId: this.creds.marketplaceId },
      timeout: 10_000,
    });
    return res.data;
  }

  private authHeaders(token: string) {
    return { "x-amz-access-token": token, "content-type": "application/json" };
  }

  private wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Pull every listing via the GET_MERCHANT_LISTINGS_ALL_DATA report:
   * create → poll until DONE → download the pre-signed doc → gunzip → parse TSV.
   */
  async getMerchantListings(): Promise<ListingRow[]> {
    const token = await this.getAccessToken();
    const base = this.creds.endpoint;
    logger.info("   📋 requesting merchant listings report from Amazon…");

    let create;
    try {
      create = await axios.post(
        `${base}/reports/2021-06-30/reports`,
        {
          reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
          marketplaceIds: [this.creds.marketplaceId],
          // `custom: "true"` makes Amazon include the optional `image-url`
          // column (legacy app's secret — without this, image_url is NULL
          // for every row).
          reportOptions: { custom: "true" },
        },
        { headers: this.authHeaders(token) },
      );
    } catch (err) {
      throw spError("Reports create", err);
    }
    const reportId = create.data?.reportId as string | undefined;
    if (!reportId) throw new Error("SP-API: no reportId returned");
    logger.info(`   📋 listings report queued (id=${reportId}) — polling…`);

    // Poll: 5s, backing off +5s up to 60s, ≤40 tries.
    let documentId: string | undefined;
    let delay = 5_000;
    for (let i = 0; i < 40; i++) {
      await this.wait(delay);
      const st = await axios.get(
        `${base}/reports/2021-06-30/reports/${reportId}`,
        { headers: this.authHeaders(token) },
      );
      const status = st.data?.processingStatus as string;
      logger.info(
        `   📋 poll #${i + 1} → status=${status} (next in ${delay / 1000}s)`,
      );
      if (status === "DONE") {
        documentId = st.data.reportDocumentId as string;
        break;
      }
      if (status === "CANCELLED" || status === "FATAL") {
        throw new Error(`SP-API report ${status}`);
      }
      if (delay < 60_000) delay += 5_000;
    }
    if (!documentId) throw new Error("SP-API report timed out");

    logger.info("   📋 listings report ready — downloading…");
    const doc = await axios.get(
      `${base}/reports/2021-06-30/documents/${documentId}`,
      { headers: this.authHeaders(token) },
    );
    const docUrl = doc.data?.url as string;
    const gz = doc.data?.compressionAlgorithm === "GZIP";

    // Pre-signed S3 URL — no auth header.
    const dl = await axios.get<ArrayBuffer>(docUrl, {
      responseType: "arraybuffer",
    });
    const buf = Buffer.from(dl.data);
    const text = gz
      ? zlib.gunzipSync(buf).toString("utf-8")
      : buf.toString("utf-8");
    logger.info(
      `   📋 listings report downloaded (${Math.round(buf.length / 1024)} KB${gz ? ", gunzipped" : ""}) — parsing…`,
    );
    const rows = parseListingsTsv(text);
    logger.info(`   📋 listings parsed → ${rows.length} rows`);
    return rows;
  }

  /**
   * Paginated FBA inventory summaries → seller-SKU → {fulfillable, pending}.
   * `details=true` is mandatory or `inventoryDetails` is absent and both
   * numbers come back 0 (this was the channel-stock-is-0 bug). startDateTime
   * is intentionally omitted so every item is returned (legacy hardcoded a
   * date which silently filtered items out).
   */
  async getFbaInventory(): Promise<Map<string, FbaQty>> {
    const token = await this.getAccessToken();
    const base = this.creds.endpoint;
    const out = new Map<string, FbaQty>();
    let nextToken: string | undefined;
    logger.info("   📦 fetching FBA inventory summaries (paginated)…");

    for (let page = 0; page < 200; page++) {
      let res;
      try {
        res = await axios.get(`${base}/fba/inventory/v1/summaries`, {
          headers: this.authHeaders(token),
          params: {
            marketplaceIds: this.creds.marketplaceId,
            details: true,
            granularityType: "Marketplace",
            granularityId: this.creds.marketplaceId,
            ...(nextToken ? { nextToken } : {}),
          },
        });
      } catch (err) {
        throw spError("FBA inventory", err);
      }
      const summaries: Array<{
        sellerSku?: string;
        inventoryDetails?: {
          fulfillableQuantity?: number;
          reservedQuantity?: { pendingTransshipmentQuantity?: number };
        };
      }> = res.data?.payload?.inventorySummaries ?? [];
      for (const s of summaries) {
        if (!s.sellerSku) continue;
        out.set(s.sellerSku, {
          fulfillable: Number(s.inventoryDetails?.fulfillableQuantity ?? 0),
          pendingTransship: Number(
            s.inventoryDetails?.reservedQuantity?.pendingTransshipmentQuantity ??
              0,
          ),
        });
      }
      nextToken = res.data?.pagination?.nextToken;
      logger.info(
        `   📦 FBA page ${page + 1} → ${summaries.length} items (total so far: ${out.size}${nextToken ? ", more pages…" : ", done"})`,
      );
      if (!nextToken) break;
    }
    return out;
  }

  /**
   * Product Pricing API v2022-05-01 getCompetitiveSummary (batch). Ported from
   * the Missed-Buy-Box app: SP-API signals a rate-limit as a 200 OK with a
   * top-level `{errors:[{code:"QuotaExceeded"}]}`, NOT a 429 — so that case is
   * detected and retried with exponential backoff alongside real 429/5xx.
   */
  async getCompetitiveSummary(
    asins: string[],
  ): Promise<CompetitiveSummaryResponse> {
    if (asins.length === 0) return { responses: [] };
    if (asins.length > 20) {
      throw new Error("getCompetitiveSummary: max 20 ASINs per batch");
    }
    const base = this.creds.endpoint;
    const includedData = ["featuredBuyingOptions", "lowestPricedOffers"];
    const requests = asins.map((asin) => ({
      asin: asin.trim().toUpperCase(),
      marketplaceId: this.creds.marketplaceId,
      includedData,
      lowestPricedOffersInputs: [
        { itemCondition: "New", offerType: "Consumer" },
      ],
      method: "GET",
      uri: "/products/pricing/2022-05-01/items/competitiveSummary",
    }));

    const maxRetries = 4;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const token = await this.getAccessToken();
      try {
        const res = await axios.post(
          `${base}/batches/products/pricing/2022-05-01/items/competitiveSummary`,
          { requests },
          {
            headers: this.authHeaders(token),
            timeout: 30_000,
            validateStatus: () => true,
          },
        );
        const data = res.data;

        if (Array.isArray(data?.errors)) {
          const quota = data.errors.find(
            (e: { code?: string }) => e?.code === "QuotaExceeded",
          );
          if (quota) {
            const e = new Error("QuotaExceeded") as Error & {
              status?: number;
              quotaExceeded?: boolean;
            };
            e.status = 429;
            e.quotaExceeded = true;
            throw e;
          }
          const first = data.errors[0];
          throw new Error(
            `SP-API competitiveSummary: ${first?.code ?? ""} ${
              first?.message ?? JSON.stringify(data.errors)
            }`.trim(),
          );
        }
        if (!Array.isArray(data?.responses)) {
          throw new Error(
            `SP-API competitiveSummary: unexpected payload ${JSON.stringify(
              data,
            ).slice(0, 200)}`,
          );
        }
        return { responses: data.responses };
      } catch (err) {
        lastErr = err;
        const status =
          (err as { status?: number }).status ??
          (axios.isAxiosError(err) ? err.response?.status : undefined);
        const quota = (err as { quotaExceeded?: boolean }).quotaExceeded;
        const retriable =
          quota ||
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504 ||
          (err as { code?: string }).code === "ECONNRESET" ||
          (err as { code?: string }).code === "ETIMEDOUT";
        if (!retriable || attempt === maxRetries) break;
        const baseDelay = quota ? 5_000 : 1_000;
        const delay = baseDelay * 2 ** attempt + Math.random() * 1_000;
        logger.warn(
          { attempt: attempt + 1, status, quota },
          "SP-API competitiveSummary retry",
        );
        await this.wait(delay);
      }
    }
    throw spError("competitiveSummary", lastErr);
  }

  /**
   * Listings Items API v2021-08-01 GET by SKU with `includedData=summaries`.
   * Returns the listing's main image + FBA barcode (fn-sku). Per-SKU call —
   * caller paces. Retries 429 once with backoff; 404 → both fields null.
   */
  async getListingSummary(
    sku: string,
  ): Promise<{
    imageUrl: string | null;
    fnSku: string | null;
    itemName: string | null;
  }> {
    const url = `${this.creds.endpoint}/listings/2021-08-01/items/${
      this.creds.sellerId
    }/${encodeURIComponent(sku)}`;
    for (let attempt = 0; attempt <= 2; attempt++) {
      const token = await this.getAccessToken();
      try {
        const res = await axios.get(url, {
          headers: { "x-amz-access-token": token },
          params: {
            marketplaceIds: this.creds.marketplaceId,
            includedData: "summaries",
          },
          timeout: 15_000,
          validateStatus: () => true,
        });
        if (res.status === 404) {
          return { imageUrl: null, fnSku: null, itemName: null };
        }
        if (res.status === 429 && attempt < 2) {
          await this.wait(2_000 * (attempt + 1) + Math.random() * 500);
          continue;
        }
        if (res.status >= 300) {
          throw new Error(
            `Listings GET ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`,
          );
        }
        const summary = res.data?.summaries?.[0] ?? {};
        return {
          imageUrl: summary.mainImage?.link ?? null,
          fnSku: summary.fnSku ?? null,
          itemName: summary.itemName ?? null,
        };
      } catch (err) {
        if (attempt === 2) throw spError("Listings GET", err);
        await this.wait(1_000 * (attempt + 1));
      }
    }
    return { imageUrl: null, fnSku: null, itemName: null };
  }

  /**
   * GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL — settled orders
   * updated in [now - daysBack, now]. Same create→poll→download→parse pattern
   * as the merchant listings report. Returns raw OrderRow[]; aggregation is
   * done by amazon/salesAggregator.ts.
   */
  async getOrdersReport(daysBack: number): Promise<OrderRow[]> {
    const token = await this.getAccessToken();
    const base = this.creds.endpoint;
    const dataStartTime = new Date(
      Date.now() - daysBack * 24 * 60 * 60 * 1000,
    ).toISOString();
    logger.info(
      `   💰 requesting orders report (last ${daysBack} days, since ${dataStartTime.slice(0, 10)})…`,
    );

    let create;
    try {
      create = await axios.post(
        `${base}/reports/2021-06-30/reports`,
        {
          reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL",
          marketplaceIds: [this.creds.marketplaceId],
          dataStartTime,
        },
        { headers: this.authHeaders(token) },
      );
    } catch (err) {
      throw spError("Orders report create", err);
    }
    const reportId = create.data?.reportId as string | undefined;
    if (!reportId) throw new Error("SP-API: no reportId returned (orders)");
    logger.info(`   💰 orders report queued (id=${reportId}) — polling…`);

    let documentId: string | undefined;
    let delay = 5_000;
    for (let i = 0; i < 40; i++) {
      await this.wait(delay);
      const st = await axios.get(
        `${base}/reports/2021-06-30/reports/${reportId}`,
        { headers: this.authHeaders(token) },
      );
      const status = st.data?.processingStatus as string;
      logger.info(
        `   💰 poll #${i + 1} → status=${status} (next in ${delay / 1000}s)`,
      );
      if (status === "DONE") {
        documentId = st.data.reportDocumentId as string;
        break;
      }
      if (status === "CANCELLED" || status === "FATAL") {
        throw new Error(`SP-API orders report ${status}`);
      }
      if (delay < 60_000) delay += 5_000;
    }
    if (!documentId) throw new Error("SP-API orders report timed out");

    const doc = await axios.get(
      `${base}/reports/2021-06-30/documents/${documentId}`,
      { headers: this.authHeaders(token) },
    );
    const docUrl = doc.data?.url as string;
    const gz = doc.data?.compressionAlgorithm === "GZIP";

    logger.info("   💰 orders report ready — downloading…");
    const dl = await axios.get<ArrayBuffer>(docUrl, {
      responseType: "arraybuffer",
    });
    const buf = Buffer.from(dl.data);
    const text = gz
      ? zlib.gunzipSync(buf).toString("utf-8")
      : buf.toString("utf-8");
    logger.info(
      `   💰 orders report downloaded (${Math.round(buf.length / 1024)} KB${gz ? ", gunzipped" : ""}) — parsing…`,
    );
    const rows = parseOrdersTsv(text);
    logger.info(`   💰 orders parsed → ${rows.length} rows`);
    return rows;
  }
}

/**
 * Turn an axios error into a message that names the real cause. LWA returns
 * `{error, error_description}` (401 invalid_client = bad/rotated client
 * secret; 400 invalid_grant = bad/expired refresh token); SP-API returns
 * `{errors:[{code,message}]}`.
 */
function spError(label: string, err: unknown): Error {
  if (axios.isAxiosError(err) && err.response) {
    const data = err.response.data as
      | {
          error?: string;
          error_description?: string;
          errors?: Array<{ code?: string; message?: string }>;
        }
      | string
      | undefined;
    let detail: string;
    if (typeof data === "string") {
      detail = data.slice(0, 300);
    } else if (data?.error) {
      detail = data.error_description
        ? `${data.error} — ${data.error_description}`
        : data.error;
    } else if (data?.errors?.[0]) {
      const e = data.errors[0];
      detail = `${e.code ?? ""} ${e.message ?? ""}`.trim();
    } else {
      detail = JSON.stringify(data ?? {}).slice(0, 300);
    }
    return new Error(`${label} ${err.response.status}: ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** GET_MERCHANT_LISTINGS_ALL_DATA is a tab-separated file with a header row. */
function parseListingsTsv(tsv: string): ListingRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  // Lowercase header lookup so we tolerate Amazon's case variations between
  // standard vs. custom-flagged reports.
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  logger.info(`   📋 report headers: ${header.join(" | ")}`);
  /** First matching index from a list of synonyms (-1 if none). */
  const colAny = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const iName = colAny("item-name", "product-name");
  const iSku = colAny("seller-sku", "sku");
  const iAsin = colAny("asin1", "asin");
  const iPrice = colAny("price");
  const iQty = colAny("quantity");
  const iImg = colAny("image-url", "main-image-url", "image_url");
  // British / US spelling + the custom-report variant.
  const iFc = colAny(
    "fulfillment-channel",
    "fulfilment-channel",
    "fulfillment_channel",
    "fulfilment_channel",
  );
  const iStatus = colAny("status", "listing-status");

  const rows: ListingRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split("\t");
    const sku = (c[iSku] ?? "").trim();
    if (!sku) continue;
    const priceRaw = (c[iPrice] ?? "").trim();
    const price = priceRaw ? Number(priceRaw) : null;
    rows.push({
      sku,
      asin: (c[iAsin] ?? "").trim() || null,
      title: (c[iName] ?? "").trim() || sku,
      price: price != null && !Number.isNaN(price) ? price : null,
      quantity: Math.trunc(Number((c[iQty] ?? "0").trim())) || 0,
      imageUrl: (c[iImg] ?? "").trim() || null,
      fulfillmentChannel: (c[iFc] ?? "").trim() || null,
      status: (c[iStatus] ?? "").trim() || "Unknown",
    });
  }
  return rows;
}

/** GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL is a tab-separated
 *  flat-file with a header row. Columns vary slightly across regions but the
 *  common ones we use are: amazon-order-id, purchase-date, sku, asin,
 *  quantity, item-price, item-status. */
function parseOrdersTsv(tsv: string): OrderRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iOrder = col("amazon-order-id");
  const iDate = col("purchase-date");
  const iSku = col("sku");
  const iAsin = col("asin");
  const iQty = col("quantity");
  const iPrice = col("item-price");
  const iStatus = col("item-status");

  const rows: OrderRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split("\t");
    const sku = (c[iSku] ?? "").trim();
    if (!sku) continue;
    const dateRaw = (c[iDate] ?? "").trim();
    const purchaseDate = dateRaw ? new Date(dateRaw) : new Date(0);
    if (Number.isNaN(purchaseDate.getTime())) continue;
    const qty = Math.trunc(Number((c[iQty] ?? "0").trim())) || 0;
    const priceRaw = (c[iPrice] ?? "").trim();
    const itemPrice = priceRaw ? Number(priceRaw) : 0;
    rows.push({
      amazonOrderId: (c[iOrder] ?? "").trim(),
      purchaseDate,
      sku,
      asin: (c[iAsin] ?? "").trim() || null,
      quantity: qty,
      itemPrice: Number.isNaN(itemPrice) ? 0 : itemPrice,
      itemStatus: (c[iStatus] ?? "").trim(),
    });
  }
  return rows;
}
