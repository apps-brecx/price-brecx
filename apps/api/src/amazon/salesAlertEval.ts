/**
 * Sales-alert evaluator. Reads the workspace's SKUs + sales_metrics and
 * emits one Alert per (sku, trigger) pair that crosses a configured threshold.
 *
 * Triggers (all per active SKU):
 *  - DROP   : 7d velocity ≥ thresholdDropPct% below prior-23d velocity
 *             (derived from 30d minus 7d so we don't need extra columns)
 *  - STALL  : zero sales over a window that covers ≥ thresholdZeroDays
 *  - LOWDOS : current stock / daily velocity < thresholdLowDays
 *
 * No outbound side-effects here — caller persists the alerts and (if it's the
 * right local time) sends the digest email.
 */
import { sql } from "../db.js";

export interface SalesAlertItem {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  stock: number;
  sales7d: number;
  sales30d: number;
  velocity: number;
  daysOfSupply: number | null;
  reason: "drop" | "stall" | "lowdos";
  severity: "info" | "warning" | "critical";
  title_full: string;
  message: string;
}

export interface SalesAlertThresholds {
  thresholdDropPct: number;
  thresholdZeroDays: number;
  thresholdLowDays: number;
  /** Restrict to SKUs carrying at least one of these tag labels;
   *  omit / empty = all tags. */
  tagLabels?: string[];
  /** Restrict to SKUs on one of these channels; omit / empty = all. */
  channels?: string[];
}

interface Row {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  stock: number;
  sales7d: number;
  sales15d: number;
  sales30d: number;
}

interface DbRow {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  stock: number;
  salesMetrics: unknown;
  sales30d: number;
  channel: string;
  tags: { label: string; color: string }[] | null;
}

function metricUnits(metrics: unknown, period: string): number {
  if (!Array.isArray(metrics)) return 0;
  const hit = metrics.find(
    (m): m is { period?: string; units?: number } =>
      typeof m === "object" && m != null && (m as { period?: string }).period === period,
  );
  return Number(hit?.units ?? 0) || 0;
}

/** Generate alert items for a single workspace based on its thresholds. */
export async function evaluateSalesAlerts(
  workspaceId: string,
  t: SalesAlertThresholds,
): Promise<SalesAlertItem[]> {
  // Read raw signals — 7d/15d/30d sales from sales_metrics jsonb, plus stock.
  // Channel + tags are joined so the caller can scope the alert to a subset.
  const rows = await sql<DbRow[]>`
    select id as "skuId", sku, asin, title, image_url as "imageUrl",
           greatest(
             stock,
             coalesce(merchant_quantity,0)
               + coalesce(fba_fulfillable_quantity,0)
               + coalesce(fba_pending_transship_quantity,0)
           ) as stock,
           sales_metrics as "salesMetrics",
           sales_30d as "sales30d",
           channel,
           tags
      from skus
     where workspace_id = ${workspaceId}
       and status = 'active'
  `;

  const channelFilter = (t.channels ?? []).filter(Boolean);
  const tagFilter = (t.tagLabels ?? [])
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  const filteredRows = rows.filter((r) => {
    if (channelFilter.length > 0 && !channelFilter.includes(r.channel))
      return false;
    if (tagFilter.length > 0) {
      const have = new Set((r.tags ?? []).map((x) => x.label.toLowerCase()));
      if (!tagFilter.some((label) => have.has(label))) return false;
    }
    return true;
  });

  const enriched: Row[] = filteredRows.map((r) => ({
    skuId: r.skuId,
    sku: r.sku,
    asin: r.asin,
    title: r.title,
    imageUrl: r.imageUrl,
    stock: r.stock,
    sales7d: metricUnits(r.salesMetrics, "7d"),
    sales15d: metricUnits(r.salesMetrics, "15d"),
    sales30d: r.sales30d || metricUnits(r.salesMetrics, "30d"),
  }));

  const out: SalesAlertItem[] = [];
  for (const r of enriched) {
    const velocity = r.sales30d / 30;
    const dos = velocity > 0 ? r.stock / velocity : null;
    const base = {
      skuId: r.skuId,
      sku: r.sku,
      asin: r.asin,
      title: r.title,
      imageUrl: r.imageUrl,
      stock: r.stock,
      sales7d: r.sales7d,
      sales30d: r.sales30d,
      velocity,
      daysOfSupply: dos,
    };

    // --- DROP trigger: 7d velocity vs prior-23d velocity ---
    // prior23dUnits = 30d − 7d → prior23dVelocity = prior23dUnits / 23
    const prior23dUnits = Math.max(0, r.sales30d - r.sales7d);
    const prior23dVelocity = prior23dUnits / 23;
    const v7 = r.sales7d / 7;
    if (prior23dVelocity > 0 && v7 < prior23dVelocity * (1 - t.thresholdDropPct / 100)) {
      const dropPct = Math.round(
        ((prior23dVelocity - v7) / prior23dVelocity) * 100,
      );
      out.push({
        ...base,
        reason: "drop",
        severity: dropPct >= 60 ? "critical" : "warning",
        title_full: `Sales dropped ${dropPct}% on ${r.sku}`,
        message: `Last 7d: ${r.sales7d} units (${v7.toFixed(2)}/day) vs prior 23d: ${prior23dUnits} units (${prior23dVelocity.toFixed(2)}/day).`,
      });
    }

    // --- STALL trigger: zero sales across the closest window ≥ thresholdZeroDays ---
    let zeroWindow = 30;
    let zeroUnits = r.sales30d;
    if (t.thresholdZeroDays <= 7) {
      zeroWindow = 7;
      zeroUnits = r.sales7d;
    } else if (t.thresholdZeroDays <= 15) {
      zeroWindow = 15;
      zeroUnits = r.sales15d;
    }
    if (zeroUnits === 0 && zeroWindow >= t.thresholdZeroDays) {
      out.push({
        ...base,
        reason: "stall",
        severity: zeroWindow >= 30 ? "critical" : "warning",
        title_full: `No sales in ${zeroWindow} days on ${r.sku}`,
        message: `${r.sku} hasn't sold any units in the last ${zeroWindow} days. Current stock: ${r.stock}.`,
      });
    }

    // --- LOWDOS trigger: days-of-supply falling below threshold ---
    if (dos != null && dos < t.thresholdLowDays && r.stock > 0) {
      const daysLeft = Math.max(0, Math.round(dos));
      out.push({
        ...base,
        reason: "lowdos",
        severity: dos < 7 ? "critical" : "warning",
        title_full: `Running out: ${daysLeft}d of stock on ${r.sku}`,
        message: `${r.stock} units left at ${velocity.toFixed(2)} units/day (30d velocity) — ~${daysLeft} days remaining.`,
      });
    }
  }

  return out;
}
