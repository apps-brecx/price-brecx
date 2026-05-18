import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().optional(),
  search: z.string().optional(),
});

const cols = sql`
  id, actor, action, entity_type as "entityType", entity_id as "entityId",
  summary, meta, created_at as "createdAt"
`;

export default async function activityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/activity", async (req) => {
    const q = query.parse(req.query);
    const wsId = req.user!.workspaceId;
    const offset = (q.page - 1) * q.pageSize;
    const search = q.search ? `%${q.search}%` : null;
    const where = sql`
      where workspace_id = ${wsId}
      ${q.action ? sql`and action = ${q.action}` : sql``}
      ${search ? sql`and summary ilike ${search}` : sql``}
    `;
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from activity_log ${where}
    `;
    const items = await sql`
      select ${cols} from activity_log ${where}
      order by created_at desc
      limit ${q.pageSize} offset ${offset}
    `;
    return { items, total: count, page: q.page, pageSize: q.pageSize };
  });
}
