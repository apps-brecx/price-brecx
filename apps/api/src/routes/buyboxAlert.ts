import type { FastifyInstance } from "fastify";
import {
  buyboxAlertCreateSchema,
  buyboxAlertUpdateSchema,
  type BuyboxAlert,
} from "@fbm/shared";
import { sql, jsonb } from "../db.js";

const cols = sql`
  id, name, enabled, send_time as "sendTime", timezone, emails,
  reasons, special_only as "specialOnly",
  last_sent_on as "lastSentOn", created_at as "createdAt",
  updated_at as "updatedAt"
`;

/**
 * Buy Box alerts — a workspace can configure many, each with its own schedule,
 * recipients, and filter (loss reasons + the Syruvia/Bursting preset). The
 * daily digest is sent by BUYBOX_ALERT_DIGEST_QUEUE, which evaluates each
 * alert's filter against the latest Lost Buy Box scan.
 */
export default async function buyboxAlertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/buybox-alert", async (req): Promise<{ items: BuyboxAlert[] }> => {
    const items = await sql<BuyboxAlert[]>`
      select ${cols} from buybox_alerts
      where workspace_id = ${req.user!.workspaceId}
      order by created_at asc
    `;
    return { items: items as BuyboxAlert[] };
  });

  app.post("/buybox-alert", async (req, reply): Promise<BuyboxAlert> => {
    const body = buyboxAlertCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into buybox_alerts
        (workspace_id, name, enabled, send_time, timezone, emails,
         reasons, special_only)
      values (
        ${req.user!.workspaceId}, ${body.name}, ${body.enabled},
        ${body.sendTime}, ${body.timezone}, ${jsonb(body.emails)},
        ${jsonb(body.reasons)}, ${body.specialOnly}
      )
      returning ${cols}
    `;
    return reply.code(201).send(row as BuyboxAlert);
  });

  app.put("/buybox-alert/:id", async (req, reply): Promise<BuyboxAlert> => {
    const { id } = req.params as { id: string };
    const body = buyboxAlertUpdateSchema.parse(req.body);

    // Changing the schedule/recipients/filter clears the "sent today" guard so
    // a freshly-edited alert can still fire later the same day.
    const [row] = await sql`
      update buybox_alerts set
        name         = coalesce(${body.name ?? null}, name),
        enabled      = coalesce(${body.enabled ?? null}, enabled),
        send_time    = coalesce(${body.sendTime ?? null}, send_time),
        timezone     = coalesce(${body.timezone ?? null}, timezone),
        emails       = ${body.emails ? jsonb(body.emails) : sql`emails`},
        reasons      = ${body.reasons ? jsonb(body.reasons) : sql`reasons`},
        special_only = coalesce(${body.specialOnly ?? null}, special_only),
        last_sent_on = null,
        updated_at   = now()
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning ${cols}
    `;
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row as BuyboxAlert;
  });

  app.delete("/buybox-alert/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from buybox_alerts
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
