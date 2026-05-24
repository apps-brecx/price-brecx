import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import { recordActivity } from "../lib/activity.js";

const bulkBaseSchema = z.object({
  nineyardItemId: z.number().int(),
  /** Per-account base prices. Null clears the base price for that account. */
  prices: z.record(z.string(), z.number().nullable()),
});

/**
 * Pricing page data — products grouped by NineYard master itemId, each with
 * the list of marketplace listings (one per `account × channel`).
 *
 * Distinct from `/products` (manual product table for the Products page) and
 * `/inventory` (stock-only flat list) — this view exists because the Pricing
 * UI shows a different shape: one row per master item, multi-column grid
 * across `(account, channel)` pairs.
 *
 * When the NineYard sync hasn't been run yet (no rows in nineyard_items), we
 * fall back to grouping SKUs by ASIN so the page still renders something
 * during cutover.
 */
export default async function pricingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/pricing/grid", async (req) => {
    const wsId = req.user!.workspaceId;

    // Master items come from the NineYard sync. Each row is the canonical
    // product (master SKU code + image + total stock).
    const items = await sql<
      {
        id: string;
        nineyardItemId: number;
        itemName: string;
        title: string | null;
        imageUrl: string | null;
        brand: string | null;
        totalStock: number;
        qtyOnHand: number;
        inboundStock: number;
        updatedAt: string;
      }[]
    >`
      select id, nineyard_item_id as "nineyardItemId",
             item_name as "itemName", title, image_url as "imageUrl",
             brand,
             total_stock as "totalStock",
             qty_on_hand as "qtyOnHand",
             inbound_stock as "inboundStock",
             updated_at as "updatedAt"
      from nineyard_items
      where workspace_id = ${wsId}
        and delete_flag = false
      order by item_name asc
    `;

    if (items.length === 0) {
      // Empty pre-sync state — return the same shape with zero rows so the
      // client doesn't have to special-case it.
      return { items: [], total: 0, accountChannels: [], agg: emptyAgg() };
    }

    // Pull every NineYard-linked listing in one query, then group in JS. The
    // alternative (json_agg per row) returns nulls that postgres.js can't
    // type cleanly, and the dataset is bounded (~12k SKUs).
    type ListingRow = {
      id: string;
      nineyardItemId: number | null;
      sku: string;
      account: string | null;
      channel: string;
      channelId: string | null;
      asin: string | null;
      title: string;
      imageUrl: string | null;
      price: number;
      basePrice: number | null;
      defaultPrice: number | null;
      minPrice: number | null;
      maxPrice: number | null;
      stock: number;
      reserve: number | null;
      inboundStock: number | null;
      fulfillmentChannel: string | null;
      isActive: boolean;
      status: string;
      tags: { label: string; color: string }[];
    };
    const skus = await sql<ListingRow[]>`
      select id, nineyard_item_id as "nineyardItemId",
             sku, account, channel,
             channel_id as "channelId",
             asin,
             title, image_url as "imageUrl",
             price::float8 as price,
             base_price::float8 as "basePrice",
             default_price::float8 as "defaultPrice",
             min_price::float8 as "minPrice",
             max_price::float8 as "maxPrice",
             stock,
             reserve, inbound_stock as "inboundStock",
             fulfillment_channel as "fulfillmentChannel",
             is_active as "isActive",
             status,
             tags
      from skus
      where workspace_id = ${wsId}
        and account_sku_id is not null
    `;

    const byItem = new Map<number, ListingRow[]>();
    for (const s of skus) {
      if (s.nineyardItemId == null) continue;
      const arr = byItem.get(s.nineyardItemId) ?? [];
      arr.push(s);
      byItem.set(s.nineyardItemId, arr);
    }

    // Discover the (account, channel) pairs actually in use across the
    // workspace — the Pricing page uses these to render its column header.
    const acctChanSet = new Set<string>();
    for (const s of skus) {
      if (!s.account || !s.channel) continue;
      acctChanSet.add(`${s.account}|${s.channel}`);
    }
    const accountChannels = [...acctChanSet]
      .map((k) => {
        const [account, channel] = k.split("|");
        return { account, channel };
      })
      // Order: amazon first (US then CA), then alphabetical for everything else.
      .sort((a, b) => {
        const ax = a.channel === "amazon" ? 0 : 1;
        const bx = b.channel === "amazon" ? 0 : 1;
        if (ax !== bx) return ax - bx;
        return (a.account + a.channel).localeCompare(b.account + b.channel);
      });

    const rows = items.map((it) => {
      const listings = byItem.get(it.nineyardItemId) ?? [];
      // Collect tags across all listings of this product (de-dup by label).
      const tagMap = new Map<string, { label: string; color: string }>();
      for (const l of listings) {
        for (const t of l.tags ?? []) {
          if (!tagMap.has(t.label)) tagMap.set(t.label, t);
        }
      }
      return {
        id: it.id,
        nineyardItemId: it.nineyardItemId,
        name: it.title ?? it.itemName,
        itemName: it.itemName,
        imageUrl: it.imageUrl ?? listings.find((l) => l.imageUrl)?.imageUrl ?? null,
        brand: it.brand,
        totalStock: it.totalStock,
        qtyOnHand: it.qtyOnHand,
        inboundStock: it.inboundStock,
        tags: [...tagMap.values()],
        listings: listings.map((l) => ({
          skuId: l.id,
          sku: l.sku,
          account: l.account ?? "(unknown)",
          channel: l.channel,
          channelId: l.channelId,
          asin: l.asin,
          price: l.price,
          basePrice: l.basePrice,
          defaultPrice: l.defaultPrice,
          minPrice: l.minPrice,
          maxPrice: l.maxPrice,
          stock: l.stock,
          reserve: l.reserve,
          inboundStock: l.inboundStock,
          fulfillmentChannel: l.fulfillmentChannel,
          isActive: l.isActive,
          status: l.status,
        })),
      };
    });

    // KPI block — server-side so it survives client filtering.
    const totalProducts = rows.length;
    const issuesCount = rows.filter((r) =>
      r.listings.some((l) => l.basePrice != null && l.price < l.basePrice),
    ).length;
    const fullyListed = rows.filter((r) =>
      accountChannels.every(({ account, channel }) =>
        r.listings.some(
          (l) => l.account === account && l.channel === channel,
        ),
      ),
    ).length;

    return {
      items: rows,
      total: rows.length,
      accountChannels,
      agg: {
        totalProducts,
        issuesCount,
        fullyListedCount: fullyListed,
        accountChannelCount: accountChannels.length,
      },
    };
  });

  /**
   * Bulk-update base prices across all SKUs of a product, grouped by account.
   * The Pricing page's "Edit base prices" modal posts a single payload with
   * one base price per account — we fan it out to every matching SKU row.
   */
  app.post("/pricing/base-prices", async (req, reply) => {
    const wsId = req.user!.workspaceId;
    const body = bulkBaseSchema.parse(req.body);

    let touched = 0;
    for (const [account, price] of Object.entries(body.prices)) {
      const rows = await sql<{ id: string; sku: string }[]>`
        update skus
           set base_price = ${price},
               updated_at = now()
         where workspace_id = ${wsId}
           and nineyard_item_id = ${body.nineyardItemId}
           and account = ${account}
         returning id, sku
      `;
      touched += rows.length;
    }

    if (touched === 0) {
      return reply.code(404).send({ error: "No matching SKUs" });
    }
    await recordActivity({
      workspaceId: wsId,
      actor: req.user!.email,
      action: "updated",
      entityType: "sku",
      entityId: null,
      summary: `Bulk base prices updated for item ${body.nineyardItemId} — ${touched} SKUs`,
      meta: { nineyardItemId: body.nineyardItemId, prices: body.prices },
    });
    return { ok: true, touched };
  });
}

function emptyAgg() {
  return {
    totalProducts: 0,
    issuesCount: 0,
    fullyListedCount: 0,
    accountChannelCount: 0,
  };
}
