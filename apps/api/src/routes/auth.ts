import type { FastifyInstance } from "fastify";
import { signInSchema, signUpSchema, SESSION_COOKIE } from "@fbm/shared";
import { sql } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
} from "../auth/sessions.js";
import { env } from "../env.js";
import { recordActivity } from "../lib/activity.js";

const cookieOpts = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.COOKIE_SECURE,
  maxAge: 30 * 86400,
};

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/sign-up", async (req, reply) => {
    const body = signUpSchema.parse(req.body);
    const existing = await sql`select 1 from users where email = ${body.email}`;
    if (existing.length) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const [ws] = await sql<{ id: string }[]>`
      insert into workspaces (name) values (${body.workspaceName})
      returning id
    `;
    const passwordHash = await hashPassword(body.password);
    const [user] = await sql<{ id: string }[]>`
      insert into users (workspace_id, email, name, password_hash, role)
      values (${ws.id}, ${body.email}, ${body.name}, ${passwordHash}, 'owner')
      returning id
    `;
    const token = await createSession(user.id);
    await recordActivity({
      workspaceId: ws.id,
      actor: body.email,
      action: "created",
      entityType: "workspace",
      entityId: ws.id,
      summary: `Workspace "${body.workspaceName}" created`,
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { ok: true };
  });

  app.post("/auth/sign-in", async (req, reply) => {
    const body = signInSchema.parse(req.body);
    const rows = await sql<{ id: string; password_hash: string; workspace_id: string }[]>`
      select id, password_hash, workspace_id from users where email = ${body.email}
    `;
    const user = rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const token = await createSession(user.id);
    await recordActivity({
      workspaceId: user.workspace_id,
      actor: body.email,
      action: "login",
      entityType: "user",
      entityId: user.id,
      summary: `${body.email} signed in`,
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { ok: true };
  });

  app.post("/auth/sign-out", async (req, reply) => {
    await destroySession(req.cookies?.[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
