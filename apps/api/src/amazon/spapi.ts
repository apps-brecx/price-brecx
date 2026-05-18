import axios from "axios";
import { logger } from "../logger.js";
import type { AmazonProvider, ProductOffer, SpapiCredentials } from "./types.js";

/**
 * Live Amazon Selling Partner API provider. Logic is ported from the previous
 * price-scheduling-server (LWA refresh-token grant + Listings/Catalog calls).
 */
export class SpapiProvider implements AmazonProvider {
  readonly mode = "live" as const;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly creds: SpapiCredentials) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    const res = await axios.post("https://api.amazon.com/auth/o2/token", {
      grant_type: "refresh_token",
      refresh_token: this.creds.refreshToken,
      client_id: this.creds.lwaAppId,
      client_secret: this.creds.lwaClientSecret,
    });
    this.accessToken = res.data.access_token as string;
    this.tokenExpiresAt = Date.now() + (res.data.expires_in ?? 3600) * 1000;
    return this.accessToken;
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
}
