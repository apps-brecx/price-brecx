/**
 * Price-alert evaluator. Reads the workspace's SKUs and returns rows whose
 * current `price` is below `base_price * (1 - dropPct/100)`, optionally
 * scoped to a tag-label set and/or channel set.
 *
 * No outbound side-effects here — caller (route /test or cron digest) decides
 * what to do with the matched rows.
 */
import { sql } from "../db.js";

export interface PriceAlertFilter {
  /** Required drop percent below base, integer 1..99. */
  dropPct: number;
  /** Restrict to SKUs carrying at least one of these tag labels;
   *  omit / empty = all tags. */
  tagLabels?: string[];
  /** Restrict to SKUs on one of these channels; omit / empty = all. */
  channels?: string[];
}

export interface PriceAlertItem {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  channel: string;
  basePrice: number;
  price: number;
  /** Computed actual drop percent — useful for sorting + email message. */
  dropPct: number;
  tags: { label: string; color: string }[];
}

interface DbRow {
  skuId: string;
  sku: string;
  asin: string | null;
  title: string;
  imageUrl: string | null;
  channel: string;
  basePrice: string | number | null;
  price: string | number | null;
  tags: { label: string; color: string }[] | null;
}

export async function evaluatePriceAlerts(
  workspaceId: string,
  f: PriceAlertFilter,
): Promise<PriceAlertItem[]> {
  const rows = await sql<DbRow[]>`
    select id as "skuId", sku, asin, title, image_url as "imageUrl",
           channel,
           base_price as "basePrice",
           price,
           tags
      from skus
     where workspace_id = ${workspaceId}
       and status = 'active'
       and base_price is not null
       and base_price > 0
       and price is not null
       and price > 0
       and price < base_price * (1 - ${f.dropPct} / 100.0)
  `;

  const channelFilter = (f.channels ?? []).filter(Boolean);
  const tagFilter = (f.tagLabels ?? [])
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  const out: PriceAlertItem[] = [];
  for (const r of rows) {
    if (channelFilter.length > 0 && !channelFilter.includes(r.channel))
      continue;
    const tags = r.tags ?? [];
    if (tagFilter.length > 0) {
      const have = new Set(tags.map((t) => t.label.toLowerCase()));
      if (!tagFilter.some((label) => have.has(label))) continue;
    }
    const basePrice = Number(r.basePrice);
    const price = Number(r.price);
    if (!Number.isFinite(basePrice) || !Number.isFinite(price)) continue;
    const dropPct = Math.round(((basePrice - price) / basePrice) * 100);
    out.push({
      skuId: r.skuId,
      sku: r.sku,
      asin: r.asin,
      title: r.title,
      imageUrl: r.imageUrl,
      channel: r.channel,
      basePrice,
      price,
      dropPct,
      tags,
    });
  }
  // Steepest drops first — most useful at the top of the email.
  out.sort((a, b) => b.dropPct - a.dropPct);
  return out;
}
