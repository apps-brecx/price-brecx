import type { FastifyInstance } from "fastify";
import { automationRuleCreateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";

const cols = sql`
  id, name, type, interval_hours as "intervalHours", amount,
  active, sku_ids as "skuIds", created_by as "createdBy",
  created_at as "createdAt"
`;

export default async function automationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/automation-rules", async (req) => {
    const items = await sql`
      select ${cols} from automation_rules
      where workspace_id = ${req.user!.workspaceId}
      order by created_at desc
    `;
    return { items, total: items.length };
  });

  app.post("/automation-rules", async (req, reply) => {
    const body = automationRuleCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into automation_rules
        (workspace_id, name, type, interval_hours, amount, active, sku_ids, created_by)
      values (
        ${req.user!.workspaceId}, ${body.name}, ${body.type},
        ${body.intervalHours ?? null}, ${body.amount}, ${body.active},
        ${jsonb(body.skuIds)}, ${req.user!.email}
      )
      returning ${cols}
    `;
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "created",
      entityType: "automation_rule",
      entityId: row.id,
      summary: `Automation rule "${body.name}" created`,
    });
    return reply.code(201).send(row);
  });

  app.patch("/automation-rules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { active } = req.body as { active?: boolean };
    if (typeof active !== "boolean")
      return reply.code(400).send({ error: "active required" });
    const [row] = await sql`
      update automation_rules set active = ${active}
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning ${cols}
    `;
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row;
  });

  app.delete("/automation-rules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from automation_rules
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning name
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
