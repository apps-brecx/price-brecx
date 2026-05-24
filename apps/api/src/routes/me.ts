import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  tokenFingerprint,
} from "../auth/sessions.js";
import { recordActivity } from "../lib/activity.js";
import { SESSION_COOKIE } from "@fbm/shared";

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export default async function meRoutes(app: FastifyInstance) {
  app.get(
    "/me",
    { preHandler: app.requireAuth },
    async (req) => ({ user: req.user }),
  );

  /* -------------------- Security: change password -------------------- */
  app.post(
    "/me/change-password",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const body = changePwSchema.parse(req.body);
      const userId = req.user!.id;
      const [row] = await sql<{ passwordHash: string }[]>`
        select password_hash as "passwordHash" from users where id = ${userId}
      `;
      if (!row) return reply.code(404).send({ error: "Not found" });

      if (!(await verifyPassword(body.currentPassword, row.passwordHash))) {
        return reply.code(400).send({ error: "Current password is incorrect" });
      }
      const newHash = await hashPassword(body.newPassword);
      await sql`update users set password_hash = ${newHash} where id = ${userId}`;

      // For safety, also revoke every OTHER session — keeps the current
      // browser logged in but kicks out anything stolen.
      const currentToken = req.cookies?.[SESSION_COOKIE];
      const currentHash = currentToken ? tokenFingerprint(currentToken) : "";
      await sql`
        delete from sessions
         where user_id = ${userId}
           and token_hash <> ${currentHash}
      `;
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "updated",
        entityType: "user",
        entityId: userId,
        summary: `${req.user!.email} changed password and revoked other sessions`,
      });
      return { ok: true };
    },
  );

  /* -------------------- Security: list sessions ---------------------- */
  app.get(
    "/me/sessions",
    { preHandler: app.requireAuth },
    async (req) => {
      const userId = req.user!.id;
      const currentToken = req.cookies?.[SESSION_COOKIE];
      const currentHash = currentToken ? tokenFingerprint(currentToken) : "";
      const items = await sql<
        {
          tokenHash: string;
          createdAt: string;
          expiresAt: string;
          lastSeenAt: string;
          ip: string | null;
          userAgent: string | null;
          country: string | null;
          city: string | null;
        }[]
      >`
        select token_hash as "tokenHash",
               created_at as "createdAt",
               expires_at as "expiresAt",
               last_seen_at as "lastSeenAt",
               ip, user_agent as "userAgent",
               country, city
          from sessions
         where user_id = ${userId}
           and expires_at > now()
         order by last_seen_at desc nulls last, created_at desc
      `;
      // Mark which row matches the requester's cookie so the UI can label
      // "This device" without leaking the raw token hash.
      return {
        items: items.map((s) => ({
          ...s,
          current: s.tokenHash === currentHash,
        })),
      };
    },
  );

  /* -------------------- Security: revoke a session ------------------- */
  app.delete(
    "/me/sessions/:tokenHash",
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { tokenHash } = req.params as { tokenHash: string };
      const currentToken = req.cookies?.[SESSION_COOKIE];
      const currentHash = currentToken ? tokenFingerprint(currentToken) : "";
      if (tokenHash === currentHash) {
        return reply.code(400).send({
          error: "Cannot revoke the current session — use sign out instead.",
        });
      }
      const userId = req.user!.id;
      const rows = await sql`
        delete from sessions
         where token_hash = ${tokenHash}
           and user_id = ${userId}
         returning token_hash
      `;
      if (rows.length === 0)
        return reply.code(404).send({ error: "Session not found" });
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "updated",
        entityType: "user",
        entityId: userId,
        summary: `${req.user!.email} revoked a session`,
      });
      return { ok: true };
    },
  );

  /* ------------- Security: revoke ALL sessions but current ----------- */
  app.post(
    "/me/sessions/revoke-others",
    { preHandler: app.requireAuth },
    async (req) => {
      const userId = req.user!.id;
      const currentToken = req.cookies?.[SESSION_COOKIE];
      const currentHash = currentToken ? tokenFingerprint(currentToken) : "";
      const rows = await sql`
        delete from sessions
         where user_id = ${userId}
           and token_hash <> ${currentHash}
         returning token_hash
      `;
      await recordActivity({
        workspaceId: req.user!.workspaceId,
        actor: req.user!.email,
        action: "updated",
        entityType: "user",
        entityId: userId,
        summary: `${req.user!.email} signed out of ${rows.length} other devices`,
      });
      return { ok: true, revoked: rows.length };
    },
  );

  /* -------------------- Security: login history --------------------- */
  app.get(
    "/me/login-history",
    { preHandler: app.requireAuth },
    async (req) => {
      const items = await sql<
        {
          id: string;
          createdAt: string;
          summary: string;
          meta: { ip?: string | null; userAgent?: string | null } | null;
        }[]
      >`
        select id, created_at as "createdAt", summary, meta
          from activity_log
         where workspace_id = ${req.user!.workspaceId}
           and entity_id = ${req.user!.id}
           and action = 'login'
         order by created_at desc
         limit 20
      `;
      return { items };
    },
  );
}
