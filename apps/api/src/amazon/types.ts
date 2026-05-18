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

export interface AmazonProvider {
  readonly mode: "live" | "stub";
  /** Push a new price for a SKU to the marketplace. */
  updatePrice(sku: string, price: number): Promise<{ ok: boolean; detail?: unknown }>;
  /** Fetch the current offer/pricing for a SKU. */
  getOffer(sku: string): Promise<ProductOffer | null>;
  /** Fetch catalog details for an ASIN. */
  getCatalogItem(asin: string): Promise<unknown>;
}
