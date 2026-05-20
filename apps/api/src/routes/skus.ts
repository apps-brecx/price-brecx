import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { skuCreateSchema, skuUpdateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";
import { enqueueAmazonSync } from "../jobs.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  channel: z.string().optional(),
  favorite: z.coerce.boolean().optional(),
  /** Restrict to SKUs that have an active price schedule. */
  scheduled: z.coerce.boolean().optional(),
});

const selectCols = sql`
  id, sku, asin, title, image_url as "imageUrl", channel,
  fulfillment_channel as "fulfillmentChannel",
  fn_sku as "fnSku",
  price::float8 as price, base_price::float8 as "basePrice",
  cost::float8 as cost, stock, sales_30d as "sales30d",
  sales_metrics as "salesMetrics",
  status, favorite, tags,
  created_at as "createdAt", updated_at as "updatedAt"
`;

export default async function skuRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/skus", async (req) => {
    const q = listQuery.parse(req.query);
    const wsId = req.user!.workspaceId;
    const offset = (q.page - 1) * q.pageSize;
    const search = q.search ? `%${q.search}%` : null;

    const where = sql`
      where workspace_id = ${wsId}
      ${search ? sql`and (sku ilike ${search} or title ilike ${search} or asin ilike ${search})` : sql``}
      ${q.status ? sql`and status = ${q.status}` : sql``}
      ${q.channel ? sql`and channel = ${q.channel}` : sql``}
      ${q.favorite ? sql`and favorite = true` : sql``}
      ${q.scheduled ? sql`and id in (
          select sku_id from price_schedules
          where workspace_id = ${wsId}
            and status in ('scheduled','running')
        )` : sql``}
    `;

    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from skus ${where}
    `;
    const items = await sql`
      select ${selectCols} from skus ${where}
      order by updated_at desc
      limit ${q.pageSize} offset ${offset}
    `;
    return { items, total: count, page: q.page, pageSize: q.pageSize };
  });

  /**
   * Kick off an Amazon → DB sync for the caller's workspace. Runs async via
   * pg-boss (the merchant-listings report can take minutes); the SKUs list
   * refreshes over the websocket ("skus_synced") when it finishes.
   */
  app.post("/skus/sync", async (req) => {
    await enqueueAmazonSync({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
    });
    return { ok: true };
  });

  /**
   * Stat cards on the SKUs page: active count, scheduled updates count,
   * total channel stock, and 30-day sales revenue. One round-trip for all 4.
   */
  app.get("/skus/stats", async (req) => {
    const wsId = req.user!.workspaceId;
    const [row] = await sql<
      {
        activeSkus: number;
        scheduledUpdates: number;
        totalChannelStock: number;
        sales30d: number;
      }[]
    >`
      select
        (select count(*)::int from skus
           where workspace_id = ${wsId} and status = 'active') as "activeSkus",
        (select count(*)::int from price_schedules
           where workspace_id = ${wsId}
             and status in ('scheduled','running')) as "scheduledUpdates",
        (select coalesce(sum(stock),0)::int from skus
           where workspace_id = ${wsId}) as "totalChannelStock",
        (select coalesce(sum(
            ((m->>'units')::int) * (s.price::float8)
          ), 0)::float8
         from skus s,
              jsonb_array_elements(s.sales_metrics) m
         where s.workspace_id = ${wsId}
           and m->>'period' = '30d') as "sales30d"
    `;
    return row;
  });

  app.get("/skus/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      select ${selectCols} from skus
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return rows[0];
  });

  app.post("/skus", async (req, reply) => {
    const body = skuCreateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;
    const [row] = await sql`
      insert into skus
        (workspace_id, sku, asin, title, image_url, channel, price,
         base_price, cost, stock, sales_30d, status, favorite, tags)
      values (
        ${wsId}, ${body.sku}, ${body.asin ?? null}, ${body.title},
        ${body.imageUrl ?? null}, ${body.channel}, ${body.price},
        ${body.basePrice ?? null}, ${body.cost ?? null},
        ${body.stock ?? 0}, ${body.sales30d ?? 0}, ${body.status},
        ${body.favorite ?? false}, ${jsonb(body.tags ?? [])}
      )
      returning ${selectCols}
    `;
    await recordActivity({
      workspaceId: wsId,
      actor: req.user!.email,
      action: "created",
      entityType: "sku",
      entityId: row.id,
      summary: `SKU ${body.sku} created`,
    });
    return reply.code(201).send(row);
  });

  app.patch("/skus/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = skuUpdateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    const patch: Record<string, unknown> = {};
    if (body.sku !== undefined) patch.sku = body.sku;
    if (body.asin !== undefined) patch.asin = body.asin;
    if (body.title !== undefined) patch.title = body.title;
    if (body.imageUrl !== undefined) patch.image_url = body.imageUrl;
    if (body.channel !== undefined) patch.channel = body.channel;
    if (body.price !== undefined) patch.price = body.price;
    if (body.basePrice !== undefined) patch.base_price = body.basePrice;
    if (body.cost !== undefined) patch.cost = body.cost;
    if (body.stock !== undefined) patch.stock = body.stock;
    if (body.sales30d !== undefined) patch.sales_30d = body.sales30d;
    if (body.status !== undefined) patch.status = body.status;
    if (body.favorite !== undefined) patch.favorite = body.favorite;
    if (body.tags !== undefined) patch.tags = jsonb(body.tags);
    patch.updated_at = sql`now()`;

    const cols = Object.keys(patch);
    if (cols.length === 1) return reply.code(400).send({ error: "No fields" });

    const [row] = await sql`
      update skus set ${sql(patch, ...cols)}
      where id = ${id} and workspace_id = ${wsId}
      returning ${selectCols}
    `;
    if (!row) return reply.code(404).send({ error: "Not found" });
    await recordActivity({
      workspaceId: wsId,
      actor: req.user!.email,
      action: "updated",
      entityType: "sku",
      entityId: id,
      summary: `SKU ${row.sku} updated`,
    });
    return row;
  });

  app.delete("/skus/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from skus
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning sku
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "deleted",
      entityType: "sku",
      entityId: id,
      summary: `SKU ${rows[0].sku} deleted`,
    });
    return { ok: true };
  });
}
