import type { FastifyInstance } from "fastify";
import { priceScheduleCreateSchema } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";
import { scheduleApplyPrice } from "../jobs.js";

const cols = sql`
  ps.id, ps.sku_id as "skuId", s.sku, s.title,
  ps.type, ps.status, ps.price::float8 as price,
  ps.current_price::float8 as "currentPrice",
  ps.start_date as "startDate", ps.end_date as "endDate",
  ps.time_slots as "timeSlots", ps.timezone,
  ps.created_by as "createdBy", ps.created_at as "createdAt"
`;

export default async function scheduleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/schedules", async (req) => {
    const items = await sql`
      select ${cols} from price_schedules ps
      join skus s on s.id = ps.sku_id
      where ps.workspace_id = ${req.user!.workspaceId}
      order by ps.created_at desc
    `;
    return { items, total: items.length };
  });

  app.post("/schedules", async (req, reply) => {
    const body = priceScheduleCreateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;
    const skuRows = await sql<{ id: string; sku: string }[]>`
      select id, sku from skus
      where id = ${body.skuId} and workspace_id = ${wsId}
    `;
    if (!skuRows.length) return reply.code(404).send({ error: "SKU not found" });
    const skuRow = skuRows[0];

    const [row] = await sql`
      insert into price_schedules
        (workspace_id, sku_id, type, status, price, current_price,
         start_date, end_date, time_slots, timezone, created_by)
      values (
        ${wsId}, ${body.skuId}, ${body.type}, 'scheduled',
        ${body.price}, ${body.currentPrice},
        ${body.startDate ?? null}, ${body.endDate ?? null},
        ${jsonb(body.timeSlots)}, ${body.timezone}, ${req.user!.email}
      )
      returning ${cols}
    `;

    // Single-day schedule: queue apply at start, revert at end.
    if (body.type === "single" && body.startDate) {
      await scheduleApplyPrice(
        {
          scheduleId: row.id,
          skuId: body.skuId,
          sku: skuRow.sku,
          price: body.price,
          workspaceId: wsId,
        },
        new Date(body.startDate),
      );
      if (body.endDate) {
        await scheduleApplyPrice(
          {
            scheduleId: row.id,
            skuId: body.skuId,
            sku: skuRow.sku,
            price: body.currentPrice,
            isRevert: true,
            workspaceId: wsId,
          },
          new Date(body.endDate),
        );
      }
    }

    await recordActivity({
      workspaceId: wsId,
      actor: req.user!.email,
      action: "created",
      entityType: "price_schedule",
      entityId: row.id,
      summary: `Schedule for ${skuRow.sku} → $${body.price.toFixed(2)}`,
    });
    return reply.code(201).send(row);
  });

  app.delete("/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      update price_schedules set status = 'cancelled'
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "deleted",
      entityType: "price_schedule",
      entityId: id,
      summary: `Schedule ${id} cancelled`,
    });
    return { ok: true };
  });
}
