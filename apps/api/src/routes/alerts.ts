import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";

const cols = sql`
  a.id, a.kind, a.sku_id as "skuId", s.sku, a.title, a.message,
  a.severity, a.acknowledged, a.created_at as "createdAt"
`;

const query = z.object({ kind: z.string().optional() });

/**
 * Backs the Price Alert, Sales Alert, BuyBox and stock alert pages — all are
 * the same `alerts` table filtered by `kind`.
 */
export default async function alertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/alerts", async (req) => {
    const q = query.parse(req.query);
    const items = await sql`
      select ${cols} from alerts a
      left join skus s on s.id = a.sku_id
      where a.workspace_id = ${req.user!.workspaceId}
      ${q.kind ? sql`and a.kind = ${q.kind}` : sql``}
      order by a.created_at desc
      limit 500
    `;
    return { items, total: items.length };
  });

  app.post("/alerts/:id/ack", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      update alerts set acknowledged = true
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
