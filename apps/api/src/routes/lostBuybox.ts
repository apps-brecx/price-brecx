import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ignoreCreateSchema,
  type LostBuyboxRow,
  type LostBuyboxRun,
} from "@fbm/shared";
import { sql } from "../db.js";
import { enqueueLostBuyboxScan } from "../jobs.js";
import { requestCancel, isScanActive } from "../amazon/scanControl.js";

const EMPTY_SUMMARY = {
  total: 0,
  won: 0,
  missed: 0,
  missedOtherSeller: 0,
  missedNoFeatured: 0,
  missedAnonymized: 0,
  errors: 0,
};

const ignoredCols = sql`
  asin, note, seller_sku as "sellerSku", product_name as "productName",
  image_url as "imageUrl",
  my_price::float8 as "myPrice", buybox_price::float8 as "buyboxPrice",
  buybox_seller_id as "buyboxSellerId", marketplace_id as "marketplaceId",
  ignored_at as "ignoredAt"
`;

/**
 * Lost Buy Box report — ported from the Missed-Buy-Box app. The scan itself
 * runs async (pg-boss `lost-buybox-scan`); these endpoints read the persisted
 * snapshot and manage the ignore list.
 */
export default async function lostBuyboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/lost-buybox", async (req): Promise<LostBuyboxRun> => {
    const [run] = await sql`
      select marketplace_id as "marketplaceId", inventory_count as "inventoryCount",
             summary, rows, errored_asins as "erroredAsins",
             updated_at as "updatedAt"
        from lost_buybox_runs
       where workspace_id = ${req.user!.workspaceId}
    `;
    if (!run) {
      return {
        marketplaceId: null,
        inventoryCount: 0,
        summary: EMPTY_SUMMARY,
        rows: [],
        erroredAsins: [],
        updatedAt: null,
      };
    }

    // The merchant listings report's `item-name` is sometimes blank — the
    // ingester then falls back to the SKU, which leaks into the UI as the
    // product name. Re-join against `skus` (populated by the listings/catalog
    // sync) so the snapshot picks up a real title where we have one.
    const rows = (run.rows as LostBuyboxRow[]) ?? [];
    if (rows.length > 0) {
      const asins = [...new Set(rows.map((r) => r.asin).filter(Boolean))];
      const skuLookup = await sql<
        { asin: string; title: string; imageUrl: string | null }[]
      >`
        select distinct on (asin)
               asin, title, image_url as "imageUrl"
          from skus
         where workspace_id = ${req.user!.workspaceId}
           and asin = any(${asins})
           and title is not null and title <> '' and title <> sku
         order by asin, updated_at desc
      `;
      const byAsin = new Map(skuLookup.map((r) => [r.asin, r]));
      for (const r of rows) {
        const better = byAsin.get(r.asin);
        if (!better) continue;
        const looksLikeFallback =
          !r.productName ||
          r.productName === r.asin ||
          (r.skus ?? []).includes(r.productName) ||
          r.productName === r.sellerSku;
        if (looksLikeFallback) r.productName = better.title;
        if (!r.imageUrl && better.imageUrl) r.imageUrl = better.imageUrl;
      }
    }

    return { ...run, rows } as LostBuyboxRun;
  });

  /**
   * Kick off a scan for the caller's workspace. Runs async via pg-boss (the
   * listings report + per-ASIN pricing can take minutes); the report refreshes
   * over the websocket ("lost_buybox_synced") when it finishes.
   */
  app.post("/lost-buybox/scan", async (req) => {
    // Dedupe — if a scan is already in flight for this workspace, return
    // a friendly "already running" instead of queuing another one. Without
    // this a quick double-click or the cron firing mid-scan triggers a
    // second pass right after the first finishes ("kotobar scanning cholbe?").
    if (isScanActive(req.user!.workspaceId)) {
      return { ok: false, alreadyRunning: true };
    }
    await enqueueLostBuyboxScan({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
    });
    return { ok: true };
  });

  /** Cooperatively cancel the workspace's in-flight scan (stops after the
   *  current batch). No-op if nothing is running. */
  app.post("/lost-buybox/scan/cancel", async (req) => {
    const ok = requestCancel(req.user!.workspaceId);
    return { ok };
  });

  app.get("/lost-buybox/ignored", async (req) => {
    const items = await sql`
      select ${ignoredCols} from ignored_asins
      where workspace_id = ${req.user!.workspaceId}
      order by ignored_at desc
    `;
    return { items, total: items.length };
  });

  app.post("/lost-buybox/ignored", async (req) => {
    const body = ignoreCreateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;
    const list = [
      ...new Set(
        body.asins.map((a) => a.trim().toUpperCase()).filter(Boolean),
      ),
    ];
    if (list.length === 0) return { ok: true, added: 0 };

    const snapByAsin = new Map(
      (body.rows ?? []).map((r) => [r.asin.toUpperCase(), r]),
    );
    const values = list.map((asin) => {
      const s = snapByAsin.get(asin);
      return {
        workspace_id: wsId,
        asin,
        note: body.note ?? null,
        seller_sku: s?.sellerSku ?? null,
        product_name: s?.productName ?? null,
        image_url: s?.imageUrl ?? null,
        my_price: s?.myPrice ?? null,
        buybox_price: s?.buyboxPrice ?? null,
        buybox_seller_id: s?.buyboxSellerId ?? null,
      };
    });

    await sql`
      insert into ignored_asins ${sql(
        values,
        "workspace_id",
        "asin",
        "note",
        "seller_sku",
        "product_name",
        "image_url",
        "my_price",
        "buybox_price",
        "buybox_seller_id",
      )}
      on conflict (workspace_id, asin) do update set
        note             = coalesce(excluded.note, ignored_asins.note),
        seller_sku       = coalesce(excluded.seller_sku, ignored_asins.seller_sku),
        product_name     = coalesce(excluded.product_name, ignored_asins.product_name),
        image_url        = coalesce(excluded.image_url, ignored_asins.image_url),
        my_price         = coalesce(excluded.my_price, ignored_asins.my_price),
        buybox_price     = coalesce(excluded.buybox_price, ignored_asins.buybox_price),
        buybox_seller_id = coalesce(excluded.buybox_seller_id, ignored_asins.buybox_seller_id)
    `;

    // Drop the now-ignored ASINs from the stored snapshot so they disappear
    // from the report immediately (no re-scan needed).
    await sql`
      update lost_buybox_runs set
        rows = coalesce((
          select jsonb_agg(r)
            from jsonb_array_elements(rows) r
           where upper(r->>'asin') <> all(${list})
        ), '[]'::jsonb),
        updated_at = now()
      where workspace_id = ${wsId}
    `;

    return { ok: true, added: list.length };
  });

  app.delete("/lost-buybox/ignored/:asin", async (req) => {
    const asin = String(
      (req.params as { asin: string }).asin,
    )
      .trim()
      .toUpperCase();
    await sql`
      delete from ignored_asins
      where workspace_id = ${req.user!.workspaceId} and asin = ${asin}
    `;
    return { ok: true };
  });

  // Bulk un-ignore (ported from the source app's /ignored/bulk-delete).
  app.post("/lost-buybox/ignored/bulk-delete", async (req) => {
    const { asins } = z
      .object({ asins: z.array(z.string().min(1)).min(1) })
      .parse(req.body);
    const list = [
      ...new Set(asins.map((a) => a.trim().toUpperCase()).filter(Boolean)),
    ];
    if (list.length === 0) return { ok: true, removed: 0 };
    await sql`
      delete from ignored_asins
      where workspace_id = ${req.user!.workspaceId} and asin = any(${list})
    `;
    return { ok: true, removed: list.length };
  });
}
