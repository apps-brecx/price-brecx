import type { FastifyInstance } from "fastify";
import { sql } from "../db.js";

/**
 * Sidebar badge counts. The redesign sidebar shows live counts next to
 * Products / SKUs / Inventory / Automation / Price Alert / Sales Alert.
 * One round-trip keeps the layout cheap on every navigation.
 */
export default async function navCountsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/nav-counts", async (req) => {
    const wsId = req.user!.workspaceId;
    const [row] = await sql<
      {
        products: number;
        skus: number;
        inventoryUnits: number;
        automation: number;
        priceAlerts: number;
        salesAlerts: number;
      }[]
    >`
      select
        (select count(*)::int from products
           where workspace_id = ${wsId}) as "products",
        (select count(*)::int from skus
           where workspace_id = ${wsId}) as "skus",
        (select coalesce(sum(stock),0)::int from skus
           where workspace_id = ${wsId}) as "inventoryUnits",
        (select count(*)::int from automation_rules
           where workspace_id = ${wsId}) as "automation",
        (select count(*)::int from alerts
           where workspace_id = ${wsId} and kind = 'price'
             and acknowledged = false) as "priceAlerts",
        (select count(*)::int from alerts
           where workspace_id = ${wsId} and kind = 'sales'
             and acknowledged = false) as "salesAlerts"
    `;
    return row;
  });
}
