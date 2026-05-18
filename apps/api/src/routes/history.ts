import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

/** Price-change history derived from the activity log. */
export default async function historyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/history", async (req) => {
    const items = await sql`
      select id, actor, action, entity_type as "entityType",
             entity_id as "entityId", summary, meta,
             created_at as "createdAt"
      from activity_log
      where workspace_id = ${req.user!.workspaceId}
        and action in ('price_changed','price_reverted','created','updated','deleted')
        and entity_type in ('price_schedule','sku')
      order by created_at desc
      limit 500
    `;
    return { items, total: items.length };
  });
}
