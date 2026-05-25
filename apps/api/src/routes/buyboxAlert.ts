import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buyboxAlertCreateSchema,
  buyboxAlertUpdateSchema,
  rowMatchesBuyboxFilter,
  LOST_BUYBOX_REASONS,
  type BuyboxAlert,
  type LostBuyboxRow,
} from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { sendMail, isMailerConfigured } from "../mailer.js";
import { buyBoxLossEmailHtml, buyBoxLossEmailText } from "../lib/emailTemplates.js";
import { appUrl } from "../env.js";
import { logger } from "../logger.js";

/** Body for the "send a test now" action — mirrors the on-screen alert form
 *  (recipients + filter) so it tests exactly what's being edited, saved or not. */
const buyboxAlertTestSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(20),
  reasons: z.array(z.enum(LOST_BUYBOX_REASONS)).default([]),
  specialOnly: z.boolean().default(false),
});

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

  /**
   * Send a one-off test digest now, using the supplied recipients + filter
   * (the current on-screen form), so users can verify a filter/recipient combo
   * before relying on the schedule. Evaluates the filter against the latest
   * Lost Buy Box scan and emails the matching rows.
   */
  app.post("/buybox-alert/test", async (req, reply) => {
    const body = buyboxAlertTestSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    if (!isMailerConfigured()) {
      return reply.code(503).send({
        error:
          "Email sending isn't configured on the server (SMTP). Ask an admin to set it up.",
      });
    }

    const [run] = await sql<
      {
        rows: LostBuyboxRow[] | null;
        marketplaceId: string | null;
        updatedAt: Date | null;
      }[]
    >`
      select rows, marketplace_id as "marketplaceId", updated_at as "updatedAt"
        from lost_buybox_runs where workspace_id = ${wsId}
    `;
    const allRows = run?.rows ?? [];
    if (allRows.length === 0) {
      return reply.code(409).send({
        error:
          "No Buy Box losses in the latest scan. Run a scan first, then test.",
      });
    }

    const rows = allRows.filter((r) =>
      rowMatchesBuyboxFilter(r, {
        reasons: body.reasons,
        specialOnly: body.specialOnly,
      }),
    );
    if (rows.length === 0) {
      return { ok: true, sent: false, matched: 0, total: allRows.length };
    }

    try {
      await sendMail({
        to: body.emails,
        subject: `[Buy Box · TEST] ${rows.length} ASIN${
          rows.length === 1 ? "" : "s"
        } match this alert`,
        html: buyBoxLossEmailHtml({
          rows,
          marketplaceId: run?.marketplaceId ?? null,
          reportUrl: `${appUrl}/buybox`,
          scannedAt: run?.updatedAt ? run.updatedAt.toISOString() : null,
        }),
        text: buyBoxLossEmailText({
          rows,
          marketplaceId: run?.marketplaceId ?? null,
          reportUrl: `${appUrl}/buybox`,
        }),
      });
    } catch (err) {
      logger.error({ err }, "Buy Box test email failed");
      return reply
        .code(502)
        .send({ error: "Email send failed. Check the SMTP settings." });
    }

    return {
      ok: true,
      sent: true,
      matched: rows.length,
      total: allRows.length,
    };
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
