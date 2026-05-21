import type { FastifyInstance } from "fastify";
import { productCreateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";
import { syncProductsFromSkus } from "../amazon/productsSync.js";

const cols = sql`id, name, description, asin, sku_ids as "skuIds",
                  created_at as "createdAt", updated_at as "updatedAt"`;

export default async function productRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  /**
   * Returns products + per-channel snapshot + KPIs the Products page renders.
   * Channel prices are picked from the SKUs linked to each product (the first
   * SKU per channel — sellers list the same product once per marketplace).
   */
  app.get("/products", async (req) => {
    const wsId = req.user!.workspaceId;

    const rawProducts = await sql<
      {
        id: string;
        name: string;
        description: string | null;
        asin: string | null;
        skuIds: string[];
        createdAt: string;
        updatedAt: string | null;
      }[]
    >`
      select ${cols} from products
      where workspace_id = ${wsId}
      order by created_at desc
    `;

    // Resolve linked SKUs once — covers every SKU id referenced by any product.
    const allIds = [...new Set(rawProducts.flatMap((p) => p.skuIds))];
    const linked = allIds.length
      ? await sql<
          {
            id: string;
            sku: string;
            asin: string | null;
            title: string;
            channel: string;
            price: number;
            basePrice: number | null;
          }[]
        >`
          select id, sku, asin, title, channel,
                 price::float8 as price,
                 base_price::float8 as "basePrice"
            from skus
           where workspace_id = ${wsId}
             and id = any(${allIds})
        `
      : [];
    const skuById = new Map(linked.map((s) => [s.id, s]));

    const items = rawProducts.map((p) => {
      const skus = p.skuIds
        .map((id) => skuById.get(id))
        .filter(Boolean) as (typeof linked)[number][];
      // First SKU per channel — assumes one listing per marketplace per product.
      const channels: Record<
        string,
        { sku: string; price: number; basePrice: number | null }
      > = {};
      for (const s of skus) {
        if (!channels[s.channel]) {
          channels[s.channel] = {
            sku: s.sku,
            price: s.price,
            basePrice: s.basePrice,
          };
        }
      }
      const primarySku = skus[0]?.sku ?? "—";
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        asin: p.asin,
        skuIds: p.skuIds,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        primarySku,
        skuCount: skus.length,
        channels,
      };
    });

    // KPIs — keep aggregates server-side so the UI shows real totals even when
    // the table is filtered/searched client-side.
    const knownChannels = [...new Set(linked.map((s) => s.channel))];
    const totalProducts = items.length;
    const avgBasePrice = (() => {
      const vals = linked
        .map((s) => s.basePrice)
        .filter((v): v is number => v != null && v > 0);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    })();
    const listedOnAllChannels =
      knownChannels.length > 0
        ? items.filter((p) =>
            knownChannels.every((c) => p.channels[c] != null),
          ).length
        : 0;
    const [lastEditedRow] = rawProducts.filter((p) => p.updatedAt);
    const lastEditedAt = lastEditedRow?.updatedAt ?? null;

    return {
      items,
      total: items.length,
      knownChannels,
      agg: {
        totalProducts,
        avgBasePrice,
        listedOnAllChannels,
        lastEditedAt,
      },
    };
  });

  /**
   * Manual "Sync from SKUs" — groups all ASIN-bearing SKUs into products. The
   * same function runs automatically at the end of `syncListings`, so users
   * usually never need to hit this. Useful right after the migration or to
   * pick up newly-linked SKUs without re-running a full Amazon sync.
   */
  app.post("/products/sync", async (req) => {
    const wsId = req.user!.workspaceId;
    const result = await syncProductsFromSkus(wsId);
    await recordActivity({
      workspaceId: wsId,
      actor: req.user!.email,
      action: "updated",
      entityType: "product",
      entityId: null,
      summary: `Products auto-sync — ${result.inserted} new, ${result.updated} relinked`,
      meta: { inserted: result.inserted, updated: result.updated },
    });
    return { ok: true, ...result };
  });

  app.post("/products", async (req, reply) => {
    const body = productCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into products (workspace_id, name, description, sku_ids)
      values (${req.user!.workspaceId}, ${body.name},
              ${body.description ?? null}, ${jsonb(body.skuIds)})
      returning ${cols}
    `;
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "created",
      entityType: "product",
      entityId: row.id,
      summary: `Product "${body.name}" created`,
    });
    return reply.code(201).send(row);
  });

  app.delete("/products/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from products
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning name
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
