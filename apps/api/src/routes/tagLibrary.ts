import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import { recordActivity } from "../lib/activity.js";

/**
 * Workspace-wide tag catalogs. Three identical CRUD shapes mounted at
 * /tags/sku, /tags/buybox, /tags/price-alert — the table to read/write is
 * dispatched off the path so the surface is consistent and the legacy
 * app's per-section "Add tag" + "Existing tags" UI maps 1:1.
 */

type Catalog = "sku_tags" | "buybox_tags" | "price_alert_tags";
const CATALOGS: Record<string, Catalog> = {
  sku: "sku_tags",
  buybox: "buybox_tags",
  "price-alert": "price_alert_tags",
};

const VALID_COLORS = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "pink",
  "teal",
] as const;

const createSchema = z.object({
  label: z.string().min(1).max(40).trim(),
  color: z.enum(VALID_COLORS).default("gray"),
});
const updateSchema = createSchema.partial();

export default async function tagLibraryRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  /** Resolve `:kind` URL param → table name. Returns null on unknown kinds
   *  so the caller can 404 cleanly. */
  function resolveTable(kind: string): Catalog | null {
    return CATALOGS[kind] ?? null;
  }

  app.get("/tags/:kind", async (req, reply) => {
    const { kind } = req.params as { kind: string };
    const table = resolveTable(kind);
    if (!table) return reply.code(404).send({ error: "Unknown tag kind" });
    const rows = await sql<
      {
        id: string;
        label: string;
        color: string;
        createdAt: string;
        updatedAt: string;
      }[]
    >`
      select id, label, color,
             created_at as "createdAt", updated_at as "updatedAt"
        from ${sql(table)}
       where workspace_id = ${req.user!.workspaceId}
       order by label asc
    `;
    return { items: rows };
  });

  app.post("/tags/:kind", async (req, reply) => {
    const { kind } = req.params as { kind: string };
    const table = resolveTable(kind);
    if (!table) return reply.code(404).send({ error: "Unknown tag kind" });
    const body = createSchema.parse(req.body);
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into ${sql(table)} (workspace_id, label, color)
        values (${req.user!.workspaceId}, ${body.label}, ${body.color})
        returning id
      `;
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "created",
        entityType: kind + "_tag",
        entityId: row.id,
        summary: `Created ${kind} tag "${body.label}"`,
        meta: { color: body.color },
      });
      return reply.code(201).send(row);
    } catch (err) {
      // Hits the (workspace_id, lower(label)) unique index. Surface a clean
      // 409 instead of a 500 so the form can show a friendly inline error.
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message)
      ) {
        return reply
          .code(409)
          .send({ error: `Tag "${body.label}" already exists` });
      }
      throw err;
    }
  });

  app.patch("/tags/:kind/:id", async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    const table = resolveTable(kind);
    if (!table) return reply.code(404).send({ error: "Unknown tag kind" });
    const body = updateSchema.parse(req.body);
    if (body.label === undefined && body.color === undefined) {
      return reply.code(400).send({ error: "Nothing to update" });
    }
    try {
      const rows = await sql<{ id: string; label: string }[]>`
        update ${sql(table)}
           set label = coalesce(${body.label ?? null}, label),
               color = coalesce(${body.color ?? null}, color),
               updated_at = now()
         where id = ${id}
           and workspace_id = ${req.user!.workspaceId}
         returning id, label
      `;
      if (rows.length === 0)
        return reply.code(404).send({ error: "Tag not found" });
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "updated",
        entityType: kind + "_tag",
        entityId: id,
        summary: `Updated ${kind} tag "${rows[0].label}"`,
        meta: body,
      });
      return rows[0];
    } catch (err) {
      if (
        err instanceof Error &&
        /duplicate key|unique/i.test(err.message)
      ) {
        return reply
          .code(409)
          .send({ error: `Tag "${body.label}" already exists` });
      }
      throw err;
    }
  });

  app.delete("/tags/:kind/:id", async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    const table = resolveTable(kind);
    if (!table) return reply.code(404).send({ error: "Unknown tag kind" });
    const rows = await sql<{ id: string; label: string }[]>`
      delete from ${sql(table)}
       where id = ${id}
         and workspace_id = ${req.user!.workspaceId}
       returning id, label
    `;
    if (rows.length === 0)
      return reply.code(404).send({ error: "Tag not found" });
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "deleted",
      entityType: kind + "_tag",
      entityId: id,
      summary: `Deleted ${kind} tag "${rows[0].label}"`,
    });
    return { ok: true };
  });
}
