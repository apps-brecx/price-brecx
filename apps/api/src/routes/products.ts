import type { FastifyInstance } from "fastify";
import { productCreateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";

const cols = sql`id, name, description, sku_ids as "skuIds", created_at as "createdAt"`;

export default async function productRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/products", async (req) => {
    const items = await sql`
      select ${cols} from products
      where workspace_id = ${req.user!.workspaceId}
      order by created_at desc
    `;
    return { items, total: items.length };
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
