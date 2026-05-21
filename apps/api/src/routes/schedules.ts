import type { FastifyInstance } from "fastify";
import { priceScheduleCreateSchema, type TimeSlot } from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { recordActivity } from "../lib/activity.js";
import { scheduleApplyPrice } from "../jobs.js";

const cols = sql`
  ps.id, ps.sku_id as "skuId", s.sku, s.title,
  ps.type, ps.status, ps.price::float8 as price,
  ps.current_price::float8 as "currentPrice",
  ps.start_date as "startDate", ps.end_date as "endDate",
  ps.until_changed as "untilChanged",
  ps.time_slots as "timeSlots", ps.timezone,
  ps.created_by as "createdBy", ps.created_at as "createdAt"
`;

export default async function scheduleRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/schedules", async (req) => {
    const q = (req.query ?? {}) as { skuId?: string; status?: string };
    const items = await sql`
      select ${cols} from price_schedules ps
      join skus s on s.id = ps.sku_id
      where ps.workspace_id = ${req.user!.workspaceId}
      ${q.skuId ? sql`and ps.sku_id = ${q.skuId}` : sql``}
      ${q.status ? sql`and ps.status = ${q.status}` : sql``}
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

    // Validate type-specific payload before we commit anything to pg-boss.
    if (body.type === "single") {
      if (!body.startDate) {
        return reply.code(400).send({ error: "startDate is required for single schedules" });
      }
      if (!body.untilChanged && !body.endDate) {
        return reply.code(400).send({ error: "endDate is required unless untilChanged is true" });
      }
    } else {
      if (!body.timeSlots || body.timeSlots.length === 0) {
        return reply.code(400).send({
          error: `${body.type} schedule needs at least one time slot`,
        });
      }
      // Weekly day must be 0..6; monthly date 1..31.
      const bad = body.timeSlots.find((s: TimeSlot) =>
        body.type === "weekly"
          ? s.day < 0 || s.day > 6
          : s.day < 1 || s.day > 31,
      );
      if (bad) {
        return reply.code(400).send({
          error: `Invalid day/date for ${body.type} slot`,
        });
      }
    }

    const [row] = await sql`
      insert into price_schedules
        (workspace_id, sku_id, type, status, price, current_price,
         start_date, end_date, until_changed,
         time_slots, timezone, created_by)
      values (
        ${wsId}, ${body.skuId}, ${body.type}, 'scheduled',
        ${body.price}, ${body.currentPrice},
        ${body.startDate ?? null}, ${body.endDate ?? null},
        ${body.untilChanged ?? false},
        ${jsonb(body.timeSlots)}, ${body.timezone}, ${req.user!.email}
      )
      returning ${cols}
    `;

    // Single-shot: queue one apply + (optionally) one revert via pg-boss
    // startAfter. Weekly/monthly are picked up by SCHEDULE_TICK_QUEUE every
    // minute — no per-slot scheduling needed.
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
      if (!body.untilChanged && body.endDate) {
        await scheduleApplyPrice(
          {
            scheduleId: row.id,
            skuId: body.skuId,
            sku: skuRow.sku,
            price: body.currentPrice,
            revertTo: body.currentPrice,
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
      summary:
        body.type === "single"
          ? `Schedule for ${skuRow.sku} → $${body.price.toFixed(2)}${
              body.untilChanged ? " (until changed)" : ""
            }`
          : `${body.type} schedule for ${skuRow.sku} (${body.timeSlots.length} slot${
              body.timeSlots.length === 1 ? "" : "s"
            })`,
    });
    return reply.code(201).send(row);
  });

  app.delete("/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      update price_schedules set status = 'cancelled'
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
        and status not in ('cancelled','deleted')
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
