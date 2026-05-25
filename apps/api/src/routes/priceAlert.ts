import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  priceAlertCreateSchema,
  priceAlertUpdateSchema,
  SALES_CHANNELS,
  type PriceAlert,
} from "@fbm/shared";
import { sql, jsonb } from "../db.js";
import { sendMail, isMailerConfigured } from "../mailer.js";
import {
  priceAlertEmailHtml,
  priceAlertEmailText,
} from "../lib/emailTemplates.js";
import { appUrl } from "../env.js";
import { logger } from "../logger.js";
import { evaluatePriceAlerts } from "../amazon/priceAlertEval.js";

/** Body for the "send a test now" action — mirrors the on-screen alert form
 *  (recipients + dropPct + tag/channel filter) so it tests exactly what's
 *  being edited. */
const priceAlertTestSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(20),
  dropPct: z.number().int().min(1).max(99),
  tagLabels: z.array(z.string().min(1).max(40)).max(40).default([]),
  channels: z.array(z.enum(SALES_CHANNELS)).default([]),
});

const cols = sql`
  id, name, enabled, send_time as "sendTime", timezone, emails,
  drop_pct as "dropPct", tag_labels as "tagLabels", channels,
  last_sent_on as "lastSentOn", created_at as "createdAt",
  updated_at as "updatedAt"
`;

/**
 * Price alerts — a workspace can configure many, each with its own schedule,
 * recipients, drop-percent threshold, and optional tag/channel scope. The
 * daily digest is sent by PRICE_ALERT_DIGEST_QUEUE, which evaluates each
 * alert against the workspace's SKUs (price vs base_price) independently.
 */
export default async function priceAlertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/price-alert", async (req): Promise<{ items: PriceAlert[] }> => {
    const items = await sql<PriceAlert[]>`
      select ${cols} from price_alerts
      where workspace_id = ${req.user!.workspaceId}
      order by created_at asc
    `;
    return { items: items as PriceAlert[] };
  });

  app.post("/price-alert", async (req, reply): Promise<PriceAlert> => {
    const body = priceAlertCreateSchema.parse(req.body);
    const [row] = await sql`
      insert into price_alerts
        (workspace_id, name, enabled, send_time, timezone, emails,
         drop_pct, tag_labels, channels)
      values (
        ${req.user!.workspaceId}, ${body.name}, ${body.enabled},
        ${body.sendTime}, ${body.timezone}, ${jsonb(body.emails)},
        ${body.dropPct},
        ${jsonb(body.tagLabels)}, ${jsonb(body.channels)}
      )
      returning ${cols}
    `;
    return reply.code(201).send(row as PriceAlert);
  });

  app.put("/price-alert/:id", async (req, reply): Promise<PriceAlert> => {
    const { id } = req.params as { id: string };
    const body = priceAlertUpdateSchema.parse(req.body);

    const [row] = await sql`
      update price_alerts set
        name         = coalesce(${body.name ?? null}, name),
        enabled      = coalesce(${body.enabled ?? null}, enabled),
        send_time    = coalesce(${body.sendTime ?? null}, send_time),
        timezone     = coalesce(${body.timezone ?? null}, timezone),
        emails       = ${body.emails ? jsonb(body.emails) : sql`emails`},
        drop_pct     = coalesce(${body.dropPct ?? null}, drop_pct),
        tag_labels   = ${body.tagLabels ? jsonb(body.tagLabels) : sql`tag_labels`},
        channels     = ${body.channels ? jsonb(body.channels) : sql`channels`},
        last_sent_on = null,
        updated_at   = now()
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning ${cols}
    `;
    if (!row) return reply.code(404).send({ error: "Not found" });
    return row as PriceAlert;
  });

  /** Send a one-off test digest now. Same shape as the other alert /test
   *  endpoints — evaluates the current on-screen filter against live SKUs. */
  app.post("/price-alert/test", async (req, reply) => {
    const body = priceAlertTestSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    if (!isMailerConfigured()) {
      return reply.code(503).send({
        error:
          "Email sending isn't configured on the server (SMTP). Ask an admin to set it up.",
      });
    }

    const items = await evaluatePriceAlerts(wsId, {
      dropPct: body.dropPct,
      tagLabels: body.tagLabels,
      channels: body.channels,
    });

    if (items.length === 0) {
      return { ok: true, sent: false, matched: 0 };
    }

    try {
      await sendMail({
        to: body.emails,
        subject: `[Price · TEST] ${items.length} SKU${
          items.length === 1 ? "" : "s"
        } match this alert`,
        html: priceAlertEmailHtml({
          rows: items,
          dropPct: body.dropPct,
          reportUrl: `${appUrl}/price-alert`,
        }),
        text: priceAlertEmailText({
          rows: items,
          dropPct: body.dropPct,
          reportUrl: `${appUrl}/price-alert`,
        }),
      });
    } catch (err) {
      logger.error({ err }, "Price test email failed");
      return reply
        .code(502)
        .send({ error: "Email send failed. Check the SMTP settings." });
    }

    return { ok: true, sent: true, matched: items.length };
  });

  app.delete("/price-alert/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rows = await sql`
      delete from price_alerts
      where id = ${id} and workspace_id = ${req.user!.workspaceId}
      returning id
    `;
    if (!rows.length) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });
}
