import { logger } from "../logger.js";
import type { AmazonProvider, ProductOffer } from "./types.js";

/**
 * No-credential fallback. It records the intent so the rest of the system
 * (schedules, jobs, activity log) works end-to-end without hitting Amazon.
 */
export class StubAmazonProvider implements AmazonProvider {
  readonly mode = "stub" as const;

  async updatePrice(sku: string, price: number) {
    logger.warn(
      { sku, price },
      "Amazon SP-API not configured — price change recorded locally only",
    );
    return { ok: true, detail: { stub: true, sku, price } };
  }

  async getOffer(sku: string): Promise<ProductOffer | null> {
    return { sku, asin: null, title: null, price: null, currency: "USD" };
  }

  async getCatalogItem(): Promise<unknown> {
    return { stub: true };
  }
}
