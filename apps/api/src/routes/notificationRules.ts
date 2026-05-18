import type { FastifyInstance } from "fastify";
import { notificationRuleCreateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";

const cols = sql`
  id, kind, name, config, emails, active, created_at as "createdAt"
`;

export default async function notificationRuleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/notification-rules", async (req) => {
    const items = await sql`
      select ${cols} from notification_rules
      where workspace_id = ${req.user!.workspaceId}
      order by created_at desc
    `;
    return { items, total: items.length };
  });

  app.post("/notification-rules", async (req, reply) => {
    const body = notificationRuleCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into notification_rules
        (workspace_id, kind, name, config, emails, active)
      values (
        ${req.user!.workspaceId}, ${body.kind}, ${body.name},
        ${jsonb(body.config)}, ${jsonb(body.emails)}, ${body.active}
      )
      returning ${cols}
    `;
    return reply.code(201).send(row);
  });

  app.delete("/notification-rules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from notification_rules
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
