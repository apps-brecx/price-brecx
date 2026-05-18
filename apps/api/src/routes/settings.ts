import type { FastifyInstance } from "fastify";
import { workspaceSettingsUpdateSchema } from "@fbm/shared";
import { sql } from "../db.js";
import { recordActivity } from "../lib/activity.js";

const cols = sql`
  id as "workspaceId", name, timezone, currency,
  default_channel as "defaultChannel"
`;

export default async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/settings", async (req) => {
    const [row] = await sql`
      select ${cols} from workspaces where id = ${req.user!.workspaceId}
    `;
    const team = await sql`
      select id, email, name, role, created_at as "createdAt"
      from users where workspace_id = ${req.user!.workspaceId}
      order by created_at asc
    `;
    return { settings: row, team };
  });

  app.patch("/settings", async (req, reply) => {
    const body = workspaceSettingsUpdateSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (body.currency !== undefined) patch.currency = body.currency;
    if (body.defaultChannel !== undefined)
      patch.default_channel = body.defaultChannel;
    const keys = Object.keys(patch);
    if (!keys.length) return reply.code(400).send({ error: "No fields" });

    const [row] = await sql`
      update workspaces set ${sql(patch, ...keys)}
      where id = ${req.user!.workspaceId}
      returning ${cols}
    `;
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "updated",
      entityType: "workspace",
      entityId: req.user!.workspaceId,
      summary: "Workspace settings updated",
    });
    return row;
  });
}
