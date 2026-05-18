import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

export default async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/dashboard", async (req) => {
    const wsId = req.user!.workspaceId;
    const [stats] = await sql<
      {
        skuCount: number;
        activeSchedules: number;
        openAlerts: number;
        revenue30d: number;
      }[]
    >`
      select
        (select count(*)::int from skus where workspace_id = ${wsId}) as "skuCount",
        (select count(*)::int from price_schedules
           where workspace_id = ${wsId} and status in ('scheduled','running')) as "activeSchedules",
        (select count(*)::int from alerts
           where workspace_id = ${wsId} and acknowledged = false) as "openAlerts",
        (select coalesce(sum(sales_30d * price),0)::float8 from skus
           where workspace_id = ${wsId}) as "revenue30d"
    `;
    const recentSchedules = await sql`
      select ps.id, s.sku, s.title, ps.price::float8 as price,
             ps.status, ps.created_at as "createdAt"
      from price_schedules ps
      join skus s on s.id = ps.sku_id
      where ps.workspace_id = ${wsId}
      order by ps.created_at desc limit 6
    `;
    const recentActivity = await sql`
      select id, actor, action, summary, created_at as "createdAt"
      from activity_log
      where workspace_id = ${wsId}
      order by created_at desc limit 8
    `;
    const topSkus = await sql`
      select id, sku, title, sales_30d as "sales30d", price::float8 as price
      from skus where workspace_id = ${wsId}
      order by sales_30d desc limit 5
    `;
    return { stats, recentSchedules, recentActivity, topSkus };
  });
}
