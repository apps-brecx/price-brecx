import type { FastifyInstance } from "fastify";
import { signInSchema, acceptInviteSchema, SESSION_COOKIE } from "@fbm/shared";
import { sql } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
} from "../auth/sessions.js";
import { hashInviteToken } from "../lib/invites.js";
import { env } from "../env.js";
import { recordActivity } from "../lib/activity.js";

const cookieOpts = {
  path: "/",
  httpOnly: true,
  sameSite: env.COOKIE_SAMESITE,
  // SameSite=None is only honoured by browsers when the cookie is Secure.
  secure: env.COOKIE_SECURE || env.COOKIE_SAMESITE === "none",
  maxAge: 30 * 86400,
};

interface InviteRow {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  role: string;
  workspace_name: string;
  expired: boolean;
  accepted: boolean;
}

async function findInvite(token: string): Promise<InviteRow | null> {
  const rows = await sql<InviteRow[]>`
    select i.id, i.workspace_id, i.email, i.name, i.role,
           w.name as workspace_name,
           (i.expires_at <= now()) as expired,
           (i.accepted_at is not null) as accepted
    from invitations i
    join workspaces w on w.id = i.workspace_id
    where i.token_hash = ${hashInviteToken(token)}
    limit 1
  `;
  return rows[0] ?? null;
}

export default async function authRoutes(app: FastifyInstance) {
  // Account creation is invite-only — there is no public sign-up route.

  app.post("/auth/sign-in", async (req, reply) => {
    const body = signInSchema.parse(req.body);
    const rows = await sql<
      { id: string; password_hash: string; workspace_id: string }[]
    >`
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

  // Invitee opens the link from the email — surface enough to render the
  // "set your password" page (without leaking that an email is registered).
  app.get("/auth/invite/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const invite = await findInvite(token);
    if (!invite || invite.accepted) {
      return reply
        .code(404)
        .send({ error: "This invitation is invalid or already used" });
    }
    if (invite.expired) {
      return reply.code(410).send({ error: "This invitation has expired" });
    }
    return {
      email: invite.email,
      name: invite.name,
      workspaceName: invite.workspace_name,
      role: invite.role,
    };
  });

  // Invitee submits their name + password — this is how an account is created.
  app.post("/auth/accept-invite", async (req, reply) => {
    const body = acceptInviteSchema.parse(req.body);
    const invite = await findInvite(body.token);
    if (!invite || invite.accepted) {
      return reply
        .code(404)
        .send({ error: "This invitation is invalid or already used" });
    }
    if (invite.expired) {
      return reply.code(410).send({ error: "This invitation has expired" });
    }
    const dupe =
      await sql`select 1 from users where email = ${invite.email} limit 1`;
    if (dupe.length) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(body.password);
    const [user] = await sql<{ id: string }[]>`
      insert into users (workspace_id, email, name, password_hash, role)
      values (${invite.workspace_id}, ${invite.email}, ${body.name},
              ${passwordHash}, ${invite.role})
      returning id
    `;
    await sql`
      update invitations set accepted_at = now() where id = ${invite.id}
    `;
    const token = await createSession(user.id);
    await recordActivity({
      workspaceId: invite.workspace_id,
      actor: invite.email,
      action: "created",
      entityType: "user",
      entityId: user.id,
      summary: `${invite.email} accepted their invitation`,
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts);
    return { ok: true };
  });
}
