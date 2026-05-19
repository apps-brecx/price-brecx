import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { inviteCreateSchema, userUpdateSchema } from "@fbm/shared";
import { sql } from "../db.js";
import { hashPassword } from "../auth/sessions.js";
import {
  newInviteToken,
  inviteExpiry,
  INVITE_TTL_DAYS,
} from "../lib/invites.js";
import { inviteEmailHtml, inviteEmailText } from "../lib/emailTemplates.js";
import { sendMail } from "../mailer.js";
import { recordActivity } from "../lib/activity.js";
import { appUrl } from "../env.js";

const userCols = sql`
  id, email, name, role, workspace_id as "workspaceId",
  created_at as "createdAt"
`;
const inviteCols = sql`
  id, email, name, role, invited_by as "invitedBy",
  expires_at as "expiresAt", created_at as "createdAt"
`;

function isAdmin(req: FastifyRequest): boolean {
  return req.user!.role === "admin";
}

/** 403 unless the caller is an admin. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!isAdmin(req)) {
    await reply.code(403).send({ error: "Admin access required" });
  }
}

async function adminCount(workspaceId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from users
    where workspace_id = ${workspaceId} and role = 'admin'
  `;
  return n;
}

export default async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  /**
   * Admins see the whole team + pending invitations.
   * Non-admins see only themselves (and never invitations).
   */
  app.get("/users", async (req) => {
    const wsId = req.user!.workspaceId;
    if (!isAdmin(req)) {
      const users = await sql`
        select ${userCols} from users where id = ${req.user!.id}
      `;
      return { users, invitations: [], isAdmin: false };
    }
    const users = await sql`
      select ${userCols} from users
      where workspace_id = ${wsId}
      order by created_at asc
    `;
    const invitations = await sql`
      select ${inviteCols} from invitations
      where workspace_id = ${wsId} and accepted_at is null
      order by created_at desc
    `;
    return { users, invitations, isAdmin: true };
  });

  /** Invite a new member by email (admin only). */
  app.post(
    "/users/invite",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const body = inviteCreateSchema.parse(req.body);
      const wsId = req.user!.workspaceId;
      const email = body.email.toLowerCase();

      const existing = await sql`
        select 1 from users
        where workspace_id = ${wsId} and lower(email) = ${email} limit 1
      `;
      if (existing.length) {
        return reply
          .code(409)
          .send({ error: "That email is already a member" });
      }

      // Refresh any prior pending invite for this email (new token + expiry).
      await sql`
        delete from invitations
        where workspace_id = ${wsId}
          and lower(email) = ${email}
          and accepted_at is null
      `;
      const { token, tokenHash } = newInviteToken();
      const [invite] = await sql`
        insert into invitations
          (workspace_id, email, name, role, token_hash, invited_by, expires_at)
        values (${wsId}, ${email}, ${body.name}, ${body.role}, ${tokenHash},
                ${req.user!.email}, ${inviteExpiry()})
        returning ${inviteCols}
      `;

      const [ws] = await sql<{ name: string }[]>`
        select name from workspaces where id = ${wsId}
      `;
      const acceptUrl = `${appUrl}/accept-invite?token=${token}`;
      const mailOpts = {
        workspaceName: ws?.name ?? "Priceobo",
        inviterName: req.user!.name,
        acceptUrl,
        expiresInDays: INVITE_TTL_DAYS,
      };
      await sendMail({
        to: email,
        subject: `You've been invited to ${ws?.name ?? "Priceobo"}`,
        html: inviteEmailHtml(mailOpts),
        text: inviteEmailText(mailOpts),
      });
      await recordActivity({
        workspaceId: wsId,
        actor: req.user!.email,
        action: "created",
        entityType: "invitation",
        entityId: invite.id,
        summary: `Invited ${email} as ${body.role}`,
      });
      // acceptUrl is returned so the link still works when SMTP is unset.
      return { invitation: invite, acceptUrl };
    },
  );

  /**
   * Update a user. A member may edit their own name/password; only an admin
   * may edit other members or change roles.
   */
  app.patch("/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = userUpdateSchema.parse(req.body);
    const self = id === req.user!.id;
    const admin = isAdmin(req);

    if (!self && !admin) {
      return reply
        .code(403)
        .send({ error: "You can only modify your own account" });
    }

    const [target] = await sql<{ id: string; role: string }[]>`
      select id, role from users
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
    `;
    if (!target) return reply.code(404).send({ error: "User not found" });

    if (body.role !== undefined && !admin) {
      return reply.code(403).send({ error: "Only admins can change roles" });
    }
    // Don't allow the last admin to be demoted (would lock everyone out).
    if (
      body.role !== undefined &&
      target.role === "admin" &&
      body.role !== "admin" &&
      (await adminCount(req.user!.workspaceId)) <= 1
    ) {
      return reply
        .code(400)
        .send({ error: "Cannot demote the last remaining admin" });
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.role !== undefined) patch.role = body.role;
    if (body.password !== undefined) {
      patch.password_hash = await hashPassword(body.password);
    }
    const keys = Object.keys(patch);
    if (!keys.length) return reply.code(400).send({ error: "No fields" });

    const [updated] = await sql`
      update users set ${sql(patch, ...keys)}
      where id = ${id}
      returning ${userCols}
    `;
    await recordActivity({
      workspaceId: req.user!.workspaceId,
      actor: req.user!.email,
      action: "updated",
      entityType: "user",
      entityId: id,
      summary: self
        ? `${req.user!.email} updated their profile`
        : `Updated user ${updated.email}`,
    });
    return updated;
  });

  /** Delete a member (admin only, cannot delete yourself). */
  app.delete(
    "/users/:id",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (id === req.user!.id) {
        return reply
          .code(400)
          .send({ error: "You cannot delete your own account" });
      }
      const [target] = await sql<{ email: string; role: string }[]>`
        select email, role from users
        where id = ${id} and workspace_id = ${req.user!.workspaceId}
      `;
      if (!target) return reply.code(404).send({ error: "User not found" });
      if (
        target.role === "admin" &&
        (await adminCount(req.user!.workspaceId)) <= 1
      ) {
        return reply
          .code(400)
          .send({ error: "Cannot delete the last remaining admin" });
      }
      // sessions FK is ON DELETE CASCADE — the user is signed out everywhere.
      await sql`delete from users where id = ${id}`;
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "deleted",
        entityType: "user",
        entityId: id,
        summary: `Deleted user ${target.email}`,
      });
      return { ok: true };
    },
  );

  /** Revoke a pending invitation (admin only). */
  app.delete(
    "/users/invitations/:id",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const rows = await sql`
        delete from invitations
        where id = ${id}
          and workspace_id = ${req.user!.workspaceId}
          and accepted_at is null
        returning email
      `;
      if (!rows.length) {
        return reply.code(404).send({ error: "Invitation not found" });
      }
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "deleted",
        entityType: "invitation",
        entityId: id,
        summary: `Revoked invitation for ${rows[0].email}`,
      });
      return { ok: true };
    },
  );

  /** Re-send a pending invitation with a fresh token + expiry (admin only). */
  app.post(
    "/users/invitations/:id/resend",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const wsId = req.user!.workspaceId;
      const [invite] = await sql<{ email: string; role: string }[]>`
        select email, role from invitations
        where id = ${id} and workspace_id = ${wsId} and accepted_at is null
      `;
      if (!invite) {
        return reply.code(404).send({ error: "Invitation not found" });
      }
      const { token, tokenHash } = newInviteToken();
      await sql`
        update invitations
        set token_hash = ${tokenHash}, expires_at = ${inviteExpiry()},
            invited_by = ${req.user!.email}, created_at = now()
        where id = ${id}
      `;
      const [ws] = await sql<{ name: string }[]>`
        select name from workspaces where id = ${wsId}
      `;
      const acceptUrl = `${appUrl}/accept-invite?token=${token}`;
      const mailOpts = {
        workspaceName: ws?.name ?? "Priceobo",
        inviterName: req.user!.name,
        acceptUrl,
        expiresInDays: INVITE_TTL_DAYS,
      };
      await sendMail({
        to: invite.email,
        subject: `You've been invited to ${ws?.name ?? "Priceobo"}`,
        html: inviteEmailHtml(mailOpts),
        text: inviteEmailText(mailOpts),
      });
      return { ok: true, acceptUrl };
    },
  );
}
