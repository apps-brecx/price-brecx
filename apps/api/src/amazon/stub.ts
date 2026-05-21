import { logger } from "../logger.js";
import type {
  AmazonProvider,
  CompetitiveSummaryResponse,
  FbaQty,
  ListingRow,
  OrderRow,
  ProductOffer,
} from "./types.js";

/**
 * No-credential fallback. It records the intent so the rest of the system
 * (schedules, jobs, activity log) works end-to-end without hitting Amazon.
 */
export class StubAmazonProvider implements AmazonProvider {
  readonly mode = "stub" as const;
  readonly sellerId = null;

  async updatePrice(sku: string, price: number) {
    logger.warn(
      { sku, price },
      "Amazon SP-API not configured — price change recorded locally only",
    );
    return { ok: true, detail: { stub: true, sku, price } };
  }

  async updateSalePrice(
    sku: string,
    value: number,
    startDate: string,
    endDate: string,
  ) {
    logger.warn(
      { sku, value, startDate, endDate },
      "Amazon SP-API not configured — sale price recorded locally only",
    );
    return {
      ok: true,
      detail: { stub: true, sku, value, startDate, endDate },
    };
  }

  async getOffer(sku: string): Promise<ProductOffer | null> {
    return { sku, asin: null, title: null, price: null, currency: "USD" };
  }

  async getCatalogItem(): Promise<unknown> {
    return { stub: true };
  }

  async getMerchantListings(): Promise<ListingRow[]> {
    logger.warn("Amazon SP-API not configured — merchant listings sync skipped");
    return [];
  }

  async getFbaInventory(): Promise<Map<string, FbaQty>> {
    return new Map();
  }

  async getCompetitiveSummary(): Promise<CompetitiveSummaryResponse> {
    logger.warn(
      "Amazon SP-API not configured — Buy Box scan returns no results",
    );
    return { responses: [] };
  }

  async getOrdersReport(): Promise<OrderRow[]> {
    logger.warn(
      "Amazon SP-API not configured — sales metrics sync returns no orders",
    );
    return [];
  }

  async getListingSummary(): Promise<{
    imageUrl: string | null;
    fnSku: string | null;
    itemName: string | null;
  }> {
    return { imageUrl: null, fnSku: null, itemName: null };
  }

  async getCatalogSummariesByAsin(): Promise<
    Map<string, { itemName: string | null; imageUrl: string | null }>
  > {
    return new Map();
  }

  async getOrderMetrics(): Promise<
    { intervalStart: string; unitCount: number; averageAmount: number }[]
  > {
    return [];
  }
}
