/**
 * Aggregate the raw All-Orders flat-file into per-SKU sales metrics for the
 * legacy time periods (1D / 7D / 15D / 30D). One pass over the order rows;
 * each row contributes to every bucket that includes its purchase date.
 *
 * Mirrors the legacy app's `SaleStock.salesMetrics` shape but normalized:
 *   { period: "1d" | "7d" | "15d" | "30d", units: number, revenue: number }
 */
import type { SalesMetricEntry, SalesPeriod } from "@fbm/shared";
import type { OrderRow } from "./types.js";

/** Statuses that don't count as a sale. Anything else (Shipped, Pending,
 *  PartiallyShipped, Unshipped) is treated as a fulfilled or in-flight sale. */
const NON_SALE_STATUSES = new Set([
  "Cancelled",
  "Canceled",
  "Refunded",
  "Returned",
]);

const PERIODS: { code: SalesPeriod; days: number }[] = [
  { code: "1d", days: 1 },
  { code: "7d", days: 7 },
  { code: "15d", days: 15 },
  { code: "30d", days: 30 },
];

export interface SkuAggregate {
  sku: string;
  metrics: SalesMetricEntry[];
  /** Units in the 30-day bucket — convenient mirror of the legacy `sales_30d`. */
  units30d: number;
}

export function aggregateOrders(
  orders: OrderRow[],
  now: Date = new Date(),
): SkuAggregate[] {
  const cutoffs = PERIODS.map((p) => ({
    code: p.code,
    cutoff: now.getTime() - p.days * 24 * 60 * 60 * 1000,
  }));

  // sku → period → { units, revenue }
  const acc = new Map<string, Map<SalesPeriod, { units: number; revenue: number }>>();

  for (const o of orders) {
    if (!o.sku || !o.purchaseDate) continue;
    if (NON_SALE_STATUSES.has(o.itemStatus)) continue;
    const t = o.purchaseDate.getTime();
    if (t > now.getTime()) continue; // ignore future-dated rows

    let perPeriod = acc.get(o.sku);
    if (!perPeriod) {
      perPeriod = new Map();
      acc.set(o.sku, perPeriod);
    }
    for (const { code, cutoff } of cutoffs) {
      if (t < cutoff) continue;
      const cur = perPeriod.get(code) ?? { units: 0, revenue: 0 };
      cur.units += o.quantity;
      cur.revenue += o.itemPrice * o.quantity;
      perPeriod.set(code, cur);
    }
  }

  const out: SkuAggregate[] = [];
  for (const [sku, perPeriod] of acc) {
    const metrics: SalesMetricEntry[] = PERIODS.map((p) => {
      const v = perPeriod.get(p.code) ?? { units: 0, revenue: 0 };
      return {
        period: p.code,
        units: v.units,
        revenue: Number(v.revenue.toFixed(2)),
      };
    });
    out.push({
      sku,
      metrics,
      units30d: metrics.find((m) => m.period === "30d")?.units ?? 0,
    });
  }
  return out;
}
