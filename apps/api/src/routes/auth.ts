import type { FastifyInstance } from "fastify";
import {
  signInSchema,
  acceptInviteSchema,
  otpVerifySchema,
  SESSION_COOKIE,
} from "@fbm/shared";
import { sql } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
} from "../auth/sessions.js";
import {
  issueOtp,
  verifyOtp,
  OTP_EXPIRES_IN_MINUTES,
  RateLimitError,
} from "../auth/otp.js";
import { hashInviteToken } from "../lib/invites.js";
import { env } from "../env.js";
import { recordActivity } from "../lib/activity.js";
import { sendMail } from "../mailer.js";
import { otpEmailHtml, otpEmailText } from "../lib/emailTemplates.js";

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

  /**
   * Step 1 of sign-in: verify credentials only. On success we issue a 6-digit
   * OTP, email it to the user, and respond `{ requireOtp: true }` — the
   * client then re-submits via /auth/verify-otp to actually create a session.
   *
   * No cookie is set here, and no session row is created until OTP succeeds.
   */
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

    const ip = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || req.ip || null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    let issued: { code: string; expiresAt: string };
    try {
      issued = await issueOtp(user.id);
    } catch (err) {
      if (err instanceof RateLimitError) {
        return reply.code(429).send({ error: err.message });
      }
      throw err;
    }

    // Fire-and-forget email — the response shouldn't wait for SMTP latency
    // (esp. Gmail relay's ~1-3s round-trip). Failures are logged by sendMail.
    void sendMail({
      to: body.email,
      subject: `Priceobo sign-in code: ${issued.code}`,
      html: otpEmailHtml({
        code: issued.code,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
        ip,
        userAgent,
      }),
      text: otpEmailText({
        code: issued.code,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      }),
    });

    return {
      requireOtp: true,
      email: body.email,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
    };
  });

  /**
   * Step 2 of sign-in: exchange a valid OTP for a session cookie. Mirrors
   * what the old single-step /auth/sign-in did after password verification
   * — captures IP/UA, fires the geo lookup, records the activity, sets the
   * cookie.
   */
  app.post("/auth/verify-otp", async (req, reply) => {
    const body = otpVerifySchema.parse(req.body);
    const rows = await sql<{ id: string; workspaceId: string }[]>`
      select id, workspace_id as "workspaceId"
        from users where email = ${body.email}
    `;
    const user = rows[0];
    // Same "Invalid code" error whether the user doesn't exist or the code
    // doesn't match — avoids leaking which inboxes are registered.
    if (!user) {
      return reply.code(400).send({ error: "Invalid or expired code" });
    }
    const ok = await verifyOtp(user.id, body.code);
    if (!ok) {
      return reply.code(400).send({ error: "Invalid or expired code" });
    }

    const ip = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]
      ?.trim() || req.ip || null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
    const token = await createSession(user.id, { ip, userAgent });

    // Async geo enrichment — same pattern as before.
    void (async () => {
      try {
        const { lookupIp } = await import("../auth/geoIp.js");
        const { tokenFingerprint } = await import("../auth/sessions.js");
        const geo = await lookupIp(ip);
        if (!geo.country && !geo.city) return;
        await sql`
          update sessions
             set country = ${geo.country}, city = ${geo.city}
           where token_hash = ${tokenFingerprint(token)}
        `;
      } catch {
        /* geo enrichment is best-effort */
      }
    })();

    await recordActivity({
      workspaceId: user.workspaceId,
      actor: body.email,
      action: "login",
      entityType: "user",
      entityId: user.id,
      summary: `${body.email} signed in (2FA verified)`,
      meta: { ip, userAgent },
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
