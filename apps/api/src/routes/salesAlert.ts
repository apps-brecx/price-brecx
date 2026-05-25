import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  salesAlertCreateSchema,
  salesAlertUpdateSchema,
  SALES_CHANNELS,
  type SalesAlert,
} from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { sendMail, isMailerConfigured } from "../mailer.js";
import {
  salesAlertEmailHtml,
  salesAlertEmailText,
} from "../lib/emailTemplates.js";
import { appUrl } from "../env.js";
import { logger } from "../logger.js";
import { evaluateSalesAlerts } from "../amazon/salesAlertEval.js";

/** Body for the "send a test now" action — mirrors the on-screen alert form
 *  (recipients + thresholds + filter) so it tests exactly what's being
 *  edited, saved or not. */
const salesAlertTestSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(20),
  thresholdDropPct: z.number().int().min(1).max(100),
  thresholdZeroDays: z.number().int().min(1).max(365),
  thresholdLowDays: z.number().int().min(1).max(365),
  tagLabels: z.array(z.string().min(1).max(40)).max(40).default([]),
  channels: z.array(z.enum(SALES_CHANNELS)).default([]),
});

const cols = sql`
  id, name, enabled, send_time as "sendTime", timezone, emails,
  threshold_drop_pct as "thresholdDropPct",
  threshold_zero_days as "thresholdZeroDays",
  threshold_low_days as "thresholdLowDays",
  tag_labels as "tagLabels", channels,
  last_sent_on as "lastSentOn", created_at as "createdAt",
  updated_at as "updatedAt"
`;

/**
 * Sales alerts — a workspace can configure many, each with its own thresholds,
 * recipients, and filter (tag labels + channel scope). The daily digest is
 * sent by SALES_ALERT_DIGEST_QUEUE, which evaluates each alert against the
 * workspace's SKUs + sales_metrics independently.
 */
export default async function salesAlertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/sales-alert", async (req): Promise<{ items: SalesAlert[] }> => {
    const items = await sql<SalesAlert[]>`
      select ${cols} from sales_alerts
      where workspace_id = ${req.user!.workspaceId}
      order by created_at asc
    `;
    return { items: items as SalesAlert[] };
  });

  app.post("/sales-alert", async (req, reply): Promise<SalesAlert> => {
    const body = salesAlertCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into sales_alerts
        (workspace_id, name, enabled, send_time, timezone, emails,
         threshold_drop_pct, threshold_zero_days, threshold_low_days,
         tag_labels, channels)
      values (
        ${req.user!.workspaceId}, ${body.name}, ${body.enabled},
        ${body.sendTime}, ${body.timezone}, ${jsonb(body.emails)},
        ${body.thresholdDropPct}, ${body.thresholdZeroDays},
        ${body.thresholdLowDays},
        ${jsonb(body.tagLabels)}, ${jsonb(body.channels)}
      )
      returning ${cols}
    `;
    return reply.code(201).send(row as SalesAlert);
  });

  app.put("/sales-alert/:id", async (req, reply): Promise<SalesAlert> => {
    const { id } = req.params as { id: string };
    const body = salesAlertUpdateSchema.parse(req.body);

    const [row] = await sql`
      update sales_alerts set
        name                 = coalesce(${body.name ?? null}, name),
        enabled              = coalesce(${body.enabled ?? null}, enabled),
        send_time            = coalesce(${body.sendTime ?? null}, send_time),
        timezone             = coalesce(${body.timezone ?? null}, timezone),
        emails               = ${body.emails ? jsonb(body.emails) : sql`emails`},
        threshold_drop_pct   = coalesce(${body.thresholdDropPct ?? null}, threshold_drop_pct),
        threshold_zero_days  = coalesce(${body.thresholdZeroDays ?? null}, threshold_zero_days),
        threshold_low_days   = coalesce(${body.thresholdLowDays ?? null}, threshold_low_days),
        tag_labels           = ${body.tagLabels ? jsonb(body.tagLabels) : sql`tag_labels`},
        channels             = ${body.channels ? jsonb(body.channels) : sql`channels`},
        last_sent_on         = null,
        updated_at           = now()
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning ${cols}
    `;
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row as SalesAlert;
  });

  /**
   * Send a one-off test digest now, using the supplied recipients + filter +
   * thresholds (the current on-screen form). Evaluates against the workspace's
   * current SKUs/sales_metrics and emails the matching rows.
   */
  app.post("/sales-alert/test", async (req, reply) => {
    const body = salesAlertTestSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    if (!isMailerConfigured()) {
      return reply.code(503).send({
        error:
          "Email sending isn't configured on the server (SMTP). Ask an admin to set it up.",
      });
    }

    const items = await evaluateSalesAlerts(wsId, {
      thresholdDropPct: body.thresholdDropPct,
      thresholdZeroDays: body.thresholdZeroDays,
      thresholdLowDays: body.thresholdLowDays,
      tagLabels: body.tagLabels,
      channels: body.channels,
    });

    if (items.length === 0) {
      return { ok: true, sent: false, matched: 0 };
    }

    try {
      await sendMail({
        to: body.emails,
        subject: `[Sales · TEST] ${items.length} SKU${
          items.length === 1 ? "" : "s"
        } match this alert`,
        html: salesAlertEmailHtml({
          rows: items,
          reportUrl: `${appUrl}/sales-alert`,
        }),
        text: salesAlertEmailText({
          rows: items,
          reportUrl: `${appUrl}/sales-alert`,
        }),
      });
    } catch (err) {
      logger.error({ err }, "Sales test email failed");
      return reply
        .code(502)
        .send({ error: "Email send failed. Check the SMTP settings." });
    }

    return { ok: true, sent: true, matched: items.length };
  });

  app.delete("/sales-alert/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from sales_alerts
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
